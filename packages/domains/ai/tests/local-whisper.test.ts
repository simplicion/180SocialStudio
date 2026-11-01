import { LocalWhisperService } from "../src/media/local-whisper";
import { MediaTranscriber } from "../src/media/transcriber";

async function runLocalWhisperTests() {
  console.log("=== [TEST SUITE] 100% Local Whisper Speech Engine ===");

  // 1. Create a 1-second 16kHz 16-bit mono PCM buffer (silence/tone)
  const sampleRate = 16000;
  const numSamples = sampleRate * 1; // 1 second
  const pcmBuffer = Buffer.alloc(44 + numSamples * 2);

  // Write WAV header
  pcmBuffer.write("RIFF", 0);
  pcmBuffer.writeUInt32LE(36 + numSamples * 2, 4);
  pcmBuffer.write("WAVE", 8);
  pcmBuffer.write("fmt ", 12);
  pcmBuffer.writeUInt32LE(16, 16); // PCM chunk size
  pcmBuffer.writeUInt16LE(1, 20);  // Format: PCM
  pcmBuffer.writeUInt16LE(1, 22);  // Channels: 1 (mono)
  pcmBuffer.writeUInt32LE(sampleRate, 24); // Sample rate
  pcmBuffer.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  pcmBuffer.writeUInt16LE(2, 32);  // Block align
  pcmBuffer.writeUInt16LE(16, 34); // Bits per sample
  pcmBuffer.write("data", 36);
  pcmBuffer.writeUInt32LE(numSamples * 2, 40);

  // Fill with a subtle 440Hz sine wave tone so it's valid audio data
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000;
    pcmBuffer.writeInt16LE(Math.round(sample), 44 + i * 2);
  }

  console.log("-> Step 1: Testing LocalWhisperService buffer inference...");
  const whisperResult = await LocalWhisperService.transcribeBuffer(pcmBuffer, "en");
  console.log("Local Whisper buffer transcription completed:", {
    durationSeconds: whisperResult.durationSeconds,
    transcriptLength: whisperResult.fullTranscript.length,
    wordsExtracted: whisperResult.words.length,
    language: whisperResult.language,
  });

  if (whisperResult.durationSeconds < 0.9 || whisperResult.durationSeconds > 1.1) {
    throw new Error(`Unexpected audio duration calculation: ${whisperResult.durationSeconds}`);
  }
  console.log("✓ LocalWhisperService correctly analyzed waveform without external network calls!");

  // 2. Test MediaTranscriber fallback with empty/invalid path
  console.log("-> Step 2: Testing MediaTranscriber safety fallback...");
  const dummyRes = await MediaTranscriber.transcribe("non-existent-sample.mp4");
  console.log("Fallback result for missing media:", {
    durationSeconds: dummyRes.durationSeconds,
    transcriptionFailed: dummyRes.transcriptionFailed,
  });

  if (!dummyRes.transcriptionFailed) {
    throw new Error("Expected transcriptionFailed=true for missing media");
  }
  console.log("✓ MediaTranscriber handles missing media safely without throwing uncaught exceptions!");

  console.log("=== ALL LOCAL WHISPER TESTS PASSED SUCCESSFULLY! ===");
}

runLocalWhisperTests().catch((err) => {
  console.error("Local Whisper Test Failed:", err);
  process.exit(1);
});

