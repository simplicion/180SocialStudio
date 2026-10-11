import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/data/models/autopilot.dart';
import 'package:social_studio_mobile/data/models/content_calendar.dart';
import 'package:social_studio_mobile/features/planner/detailed_script_screen.dart';

Map<String, dynamic> _payload([Map<String, dynamic> extra = const {}]) => {
      'schema': 'autopilot.v1',
      'format': 'reel',
      'spokenHook': 'Stop flossing less when your gums bleed',
      'onScreenHook': 'BLEEDING GUMS?',
      'script': {
        'hook': 'Stop flossing less when your gums bleed',
        'body': [
          {'beat': 'Bleeding means the gum is inflamed.', 'retentionDevice': 'open loop'},
          {'beat': 'Flossing daily for one week usually stops it.'},
        ],
        'retentionLoop': 'So bleeding gums are a reason to floss.',
        'cta': 'Save this for your next brush.',
      },
      'shotNotes': ['close-up at the sink'],
      ...extra,
    };

void main() {
  test('older pieces: no scores are invented and beats are only the real script lines', () {
    final b = PieceBrief.parse(jsonEncode(_payload()))!;
    expect(b.hookScore, isNull);
    expect(b.humanScore, isNull);
    expect(b.hookFormula, isNull);
    expect(b.craftScore, isNull);
    expect(b.productionScript, isNull);
    expect(b.timedBeats.map((t) => t.role), ['hook', 'body', 'body', 'loop', 'cta']);
    expect(b.timedBeats.map((t) => t.spokenWords).join('\n\n'), b.teleprompterText);
    expect(b.timedBeats.first.screenText, 'BLEEDING GUMS?');
    expect(b.timedBeats.skip(1).every((t) => t.screenText == null), isTrue);
    expect(b.timedBeats[1].retentionDevice, 'open loop');
    expect(b.timedBeats[2].retentionDevice, isNull);
    // 7 words at 165 wpm = 2.5s; the clock starts at zero and only moves by spoken time.
    expect(b.timedBeats.first.durationSec, 2.5);
    expect(b.timedBeats[1].startSec, 2.5);
    expect(b.spokenSeconds, greaterThan(8));
  });

  test('server craft report, timed beats and shooting script are read as sent', () {
    final b = PieceBrief.parse(jsonEncode(_payload({
      'hookScore': 72,
      'hookFormula': 'Negative Command',
      'humanScore': 81,
      'craft': {
        'score': 77,
        'blocking': ['Instagram copy: link is not clickable'],
        'advice': ['Hook: add a number'],
      },
      'timedBeats': [
        {'index': 1, 'timecode': '0:00.0', 'startSec': 0, 'durationSec': 2.5, 'spokenWords': 'Stop flossing less when your gums bleed', 'role': 'hook', 'flags': []},
        {'index': 2, 'timecode': '0:02.5', 'startSec': 2.5, 'durationSec': 5.1, 'spokenWords': 'A long line', 'role': 'body', 'flags': ['5.1s on one line']},
      ],
      'productionScript': {
        'totalSeconds': 12.5,
        'aspect': '9:16 (1080x1920)',
        'logline': 'Why bleeding gums mean floss more',
        'setup': {'location': 'bathroom', 'props': ['floss']},
        'scenes': [
          {'index': 1, 'timecode': '0:00.0', 'durationSec': 2.5, 'purpose': 'hook', 'spokenLine': 'Stop flossing less when your gums bleed', 'shot': 'talking_head_close', 'editCue': 'cut in'},
        ],
        'checklist': ['clean the lens'],
      },
    })))!;
    expect(b.hookScore, 72);
    expect(b.craftScore, 77);
    expect(b.craftBlocking, hasLength(1));
    expect(b.timedBeats, hasLength(2));
    expect(b.timedBeats[1].flags, ['5.1s on one line']);
    final s = b.productionScript!;
    expect(s.scenes.single.shotLabel, 'talking head close');
    expect(s.location, 'bathroom');
    expect(s.props, ['floss']);
    expect(ProductionScript.tryParse({'scenes': []}), isNull);
  });

  testWidgets('detailed script screen: timed lines, then an empty state with an action for the shooting script', (tester) async {
    final piece = CalendarPiece(id: 'p1', calendarId: 'c1', headline: 'Bleeding gums', contentType: 'Reel', videoScriptOrHooks: jsonEncode(_payload()));
    await tester.pumpWidget(ProviderScope(child: MaterialApp(home: DetailedScriptScreen(piece: piece))));
    await tester.pump();

    expect(find.text('Bleeding gums'), findsOneWidget);
    expect(find.text('Bleeding means the gum is inflamed.'), findsOneWidget);
    expect(find.text('Record with teleprompter'), findsOneWidget);
    expect(find.textContaining('Hook score'), findsNothing, reason: 'no score when the server sent none');

    await tester.tap(find.text('Shooting script'));
    await tester.pumpAndSettle();
    expect(find.text('Turn this script into a shot list'), findsOneWidget);
    expect(find.text('Back to the calendar'), findsOneWidget);
  });

  testWidgets('detailed script screen: a piece with no script shows an empty state, not an invented script', (tester) async {
    final piece = CalendarPiece(id: 'p2', calendarId: 'c1', headline: 'A static post', contentType: 'Post', videoScriptOrHooks: 'just some notes');
    await tester.pumpWidget(ProviderScope(child: MaterialApp(home: DetailedScriptScreen(piece: piece))));
    await tester.pump();
    expect(find.text('No script on this piece yet'), findsOneWidget);
  });
}
