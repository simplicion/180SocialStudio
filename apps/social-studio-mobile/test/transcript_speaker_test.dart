import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';

/// Speaker diarization (server: services/diarize-worker): the label on each word reaches the Director unchanged.
void main() {
  test('a labelled word keeps its speaker through JSON', () {
    final t = Transcript.fromJson({
      'language': 'en',
      'durationMs': 2000,
      'text': 'a b',
      'speakers': 2,
      'words': [
        {'text': 'a', 'startMs': 0, 'endMs': 300, 'speaker': 'S1'},
        {'text': 'b', 'startMs': 900, 'endMs': 1200, 'speaker': 'S2'},
      ],
    });
    expect(t.speakers, 2);
    expect(t.words.map((w) => w.speaker), ['S1', 'S2']);
    expect(t.words[1].toJson(), {'text': 'b', 'startMs': 900, 'endMs': 1200, 'speaker': 'S2'});
  });

  test('without diarization nothing is added', () {
    final w = TranscriptWord.fromJson({'text': 'a', 'startMs': 0, 'endMs': 300});
    expect(w.speaker, isNull);
    expect(w.toJson().containsKey('speaker'), isFalse);
    expect(TranscriptWord.fromJson({'text': 'a', 'startMs': 0, 'endMs': 1, 'speaker': ''}).speaker, isNull);
  });
}
