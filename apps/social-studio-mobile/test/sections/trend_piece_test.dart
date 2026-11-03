import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/data/models/content_calendar.dart';

void main() {
  test('reads expanded trend, mood and critic flags', () {
    final p = CalendarPiece.fromJson({
      'id': 'p1',
      'calendarId': 'c1',
      'trend': {
        'title': 'Creatine for women 40+',
        'whyNow': 'A wave of posts this week',
        'signal': 'rising · opportunity 78/100 · 7 posts',
        'audienceQuestions': ['Does it cause bloating?'],
        'sourceUrls': ['https://www.reddit.com/r/x/1'],
      },
      'mood': 'storytelling',
      'criticSkipped': true,
    });
    expect(p.trend!.title, 'Creatine for women 40+');
    expect(p.trend!.signal, contains('opportunity 78/100'));
    expect(p.mood, 'storytelling');
    expect(p.criticSkipped, isTrue);
  });

  test('falls back to the stored autopilot payload', () {
    final p = CalendarPiece.fromJson({
      'id': 'p2',
      'calendarId': 'c1',
      'videoScriptOrHooks': jsonEncode({
        'schema': 'autopilot.v1',
        'trend': {'title': 'Bloating myth', 'sourceUrls': []},
        'critic': {'verdict': 'ok', 'issues': [], 'skipped': true},
        'mood': 'energetic',
      }),
    });
    expect(p.trend!.title, 'Bloating myth');
    expect(p.criticSkipped, isTrue);
    expect(p.mood, 'energetic');
  });

  test('evergreen pieces have no trend and a normal review', () {
    final p = CalendarPiece.fromJson({'id': 'p3', 'calendarId': 'c1', 'videoScriptOrHooks': 'Plain legacy hooks'});
    expect(p.trend, isNull);
    expect(p.criticSkipped, isFalse);
  });
}
