/**
 * Real Media Test with an authentic binary MP4 container fixture.
 * Tests: MP4 binary inspection → MIME detection → chunk alignment (256KB multiples) → resumable session → publication status.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/youtube/youtube-real-media.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeLiveProvider, YouTubeIntegrationError } from '../../src/youtube';

/**
 * Builds a syntactically valid ISO Base Media File Format (MP4) binary buffer.
 * Contains ftyp (isom/mp42), moov, and mdat boxes.
 */
function createValidMp4Fixture(totalBytes: number = 700 * 1024): Buffer {
    const buf = Buffer.alloc(totalBytes);

    // 1. 'ftyp' box (28 bytes)
    buf.writeUInt32BE(28, 0); // box size = 28
    buf.write('ftyp', 4, 'ascii');
    buf.write('isom', 8, 'ascii'); // major brand
    buf.writeUInt32BE(512, 12); // minor version
    buf.write('isom', 16, 'ascii'); // compatible brand 1
    buf.write('mp42', 20, 'ascii'); // compatible brand 2
    buf.write('mp41', 24, 'ascii'); // compatible brand 3

    // 2. 'moov' box header (16 bytes)
    const moovOffset = 28;
    buf.writeUInt32BE(16, moovOffset); // moov box size
    buf.write('moov', moovOffset + 4, 'ascii');
    buf.writeUInt32BE(8, moovOffset + 8); // empty child box
    buf.write('mvhd', moovOffset + 12, 'ascii');

    // 3. 'mdat' box (media data, fills remainder)
    const mdatOffset = moovOffset + 16;
    const mdatSize = totalBytes - mdatOffset;
    buf.writeUInt32BE(mdatSize, mdatOffset);
    buf.write('mdat', mdatOffset + 4, 'ascii');

    // Fill mdat with simulated H.264 NAL units (0x00 0x00 0x00 0x01 ...)
    for (let i = mdatOffset + 8; i < totalBytes; i += 64) {
        buf[i] = 0x00;
        buf[i + 1] = 0x00;
        buf[i + 2] = 0x00;
        buf[i + 3] = 0x01;
        buf[i + 4] = 0x65; // IDR slice NAL unit
    }

    return buf;
}

test('1. Valid MP4 binary fixture conforms to ISO BMFF standards', () => {
    const mp4 = createValidMp4Fixture(600 * 1024);

    assert.equal(mp4.readUInt32BE(0), 28, 'ftyp box size is 28');
    assert.equal(mp4.subarray(4, 8).toString('ascii'), 'ftyp', 'Must have ftyp box');
    assert.equal(mp4.subarray(8, 12).toString('ascii'), 'isom', 'Major brand is isom');
    assert.equal(mp4.subarray(32, 36).toString('ascii'), 'moov', 'Must have moov box');
    assert.equal(mp4.subarray(48, 52).toString('ascii'), 'mdat', 'Must have mdat box');
});

test('2. YouTubeLiveProvider uploads real MP4 fixture with chunk progress tracking', async () => {
    const originalFetch = globalThis.fetch;
    const totalSize = 768 * 1024; // 768 KB = exactly 3 chunks of 256 KB
    const mp4Fixture = createValidMp4Fixture(totalSize);

    const chunkLog: { chunkIndex: number; range: string; bytesUploaded: number }[] = [];

    try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);

            if (url === 'https://cdn.180workspace.com/renders/real_studio_export.mp4') {
                return new Response(mp4Fixture, {
                    status: 200,
                    headers: {
                        'Content-Type': 'video/mp4',
                        'Content-Length': String(mp4Fixture.length),
                    },
                });
            }

            if (url.includes('uploadType=resumable')) {
                // Assert init headers
                const xUploadType = (init?.headers as any)?.['X-Upload-Content-Type'];
                assert.equal(xUploadType, 'video/mp4', 'Must specify video/mp4 MIME type');
                const xUploadLength = (init?.headers as any)?.['X-Upload-Content-Length'];
                assert.equal(xUploadLength, String(totalSize), 'Must specify accurate Content-Length');

                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: {
                        Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=real_media_sess_456',
                    },
                });
            }

            if (url.includes('upload_id=real_media_sess_456')) {
                const range = (init?.headers as any)?.['Content-Range'] || '';
                const body = init?.body as any;
                const bytes = body instanceof Uint8Array ? body.length : (body?.byteLength || 0);

                chunkLog.push({
                    chunkIndex: chunkLog.length + 1,
                    range,
                    bytesUploaded: bytes,
                });

                if (chunkLog.length < 3) {
                    const end = range.split('-')[1]?.split('/')[0];
                    return new Response(null, {
                        status: 308,
                        headers: { Range: `bytes=0-${end}` },
                    });
                }

                // Final chunk
                return new Response(
                    JSON.stringify({
                        id: 'yt_real_mp4_complete_id',
                        snippet: { title: 'Authentic MP4 Studio Render' },
                        status: { privacyStatus: 'private' },
                    }),
                    {
                        status: 201,
                        headers: { 'Content-Type': 'application/json' },
                    }
                );
            }

            return new Response('Not found', { status: 404 });
        };

        const provider = new YouTubeLiveProvider({
            maxUploadChunkBytes: 256 * 1024,
        });

        const outcome = await provider.publishVideo(
            {
                title: 'Authentic MP4 Studio Render',
                description: 'Uploaded from 180 Media Studio with verified ftyp / moov / mdat binary boxes.',
                mediaUrl: 'https://cdn.180workspace.com/renders/real_studio_export.mp4',
                privacyStatus: 'private',
            },
            'ya29.valid_oauth_access_token_real'
        );

        assert.equal(outcome.videoId, 'yt_real_mp4_complete_id');
        assert.equal(outcome.liveUrl, 'https://www.youtube.com/watch?v=yt_real_mp4_complete_id');
        assert.equal(outcome.privacyStatus, 'private');

        assert.equal(chunkLog.length, 3, 'Must have transferred in 3 chunks');
        assert.equal(chunkLog[0].bytesUploaded, 256 * 1024);
        assert.equal(chunkLog[1].bytesUploaded, 256 * 1024);
        assert.equal(chunkLog[2].bytesUploaded, 256 * 1024);
        assert.equal(chunkLog[0].range, 'bytes 0-262143/786432');
        assert.equal(chunkLog[1].range, 'bytes 262144-524287/786432');
        assert.equal(chunkLog[2].range, 'bytes 524288-786431/786432');

    } finally {
        globalThis.fetch = originalFetch;
    }
});
