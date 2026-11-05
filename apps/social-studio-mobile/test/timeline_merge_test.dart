import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_merge.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Three-way merge of a Director response onto edits the creator made meanwhile (audit F-01, F-02, F-05).
MobileEditIr base() => TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1080, height: 1920);

MergeResult merge(MobileEditIr b, MobileEditIr mine, MobileEditIr theirs) => TimelineMerge.merge(base: b, mine: mine, theirs: theirs);

void main() {
  group('fast paths', () {
    test('creator did nothing meanwhile: the Director version is taken as is', () {
      final b = base();
      final theirs = TimelineOps.addZoom(b, startMs: 1000);
      final r = merge(b, b, theirs);
      expect(identical(r.ir, theirs), isTrue);
      expect(r.conflicts, isEmpty);
    });

    test('Director changed nothing: the creator version is kept as is', () {
      final b = base();
      final mine = TimelineOps.addText(b, 'Hi', startMs: 0, durationMs: 1000);
      expect(identical(merge(b, mine, b).ir, mine), isTrue);
    });
  });

  group('item lanes', () {
    test('Director adds a zoom, creator adds a title: both kept', () {
      final b = base();
      final r = merge(b, TimelineOps.addText(b, 'Mine', startMs: 0, durationMs: 1000), TimelineOps.addZoom(b, startMs: 2000));
      expect(r.ir.captions.map((c) => c.text), ['Mine']);
      expect(r.ir.zooms, hasLength(1));
      expect(r.conflicts, isEmpty);
    });

    test('Director removes an item the creator did not touch: removed', () {
      final b = TimelineOps.addZoom(base(), startMs: 2000);
      final z = b.zooms.single.id;
      final mine = TimelineOps.addText(b, 'x', startMs: 0, durationMs: 500);
      final r = merge(b, mine, TimelineOps.removeZoom(b, z));
      expect(r.ir.zooms, isEmpty);
      expect(r.ir.captions, hasLength(1));
    });

    test('Director removes an item the creator changed: kept, with a note', () {
      final b = TimelineOps.addText(base(), 'Old', startMs: 0, durationMs: 1000);
      final id = b.captions.single.id;
      final mine = TimelineOps.editText(b, id, text: 'Fixed typo');
      final r = merge(b, mine, TimelineOps.removeCaption(b, id));
      expect(r.ir.captions.single.text, 'Fixed typo');
      expect(r.conflicts, isNotEmpty);
    });

    test('creator removed an item the Director left alone: stays removed', () {
      final b = TimelineOps.addZoom(TimelineOps.addText(base(), 'T', startMs: 0, durationMs: 1000), startMs: 3000);
      final mine = TimelineOps.removeZoom(b, b.zooms.single.id);
      final theirs = TimelineOps.addEffect(b, 'flash', startMs: 5000, durationMs: 300);
      final r = merge(b, mine, theirs);
      expect(r.ir.zooms, isEmpty);
      expect(r.ir.effects, hasLength(1));
    });

    test('creator removed an item the Director changed: stays removed', () {
      final b = TimelineOps.addZoom(base(), startMs: 3000);
      final id = b.zooms.single.id;
      final mine = TimelineOps.removeZoom(b, id);
      final theirs = TimelineOps.moveItem(b, TrackKind.zoom, id, 5000);
      expect(merge(b, mine, theirs).ir.zooms, isEmpty);
    });

    test('Director modifies an item the creator did not touch: Director version', () {
      final b = TimelineOps.addText(base(), 'Title', startMs: 0, durationMs: 1000);
      final id = b.captions.single.id;
      final mine = TimelineOps.addZoom(b, startMs: 4000);
      final theirs = TimelineOps.editText(b, id, style: {'textColor': '#FFE600'});
      final r = merge(b, mine, theirs);
      expect(r.ir.captions.single.style['textColor'], '#FFE600');
      expect(r.ir.zooms, hasLength(1));
    });

    test('both modify the same item: the creator version wins, with a note', () {
      final b = TimelineOps.addText(base(), 'Title', startMs: 0, durationMs: 1000);
      final id = b.captions.single.id;
      final mine = TimelineOps.editText(b, id, text: 'Mine');
      final theirs = TimelineOps.editText(b, id, text: 'Theirs');
      final r = merge(b, mine, theirs);
      expect(r.ir.captions.single.text, 'Mine');
      expect(r.conflicts.single, contains('your version was kept'));
    });

    test('effects, B-roll and sound effects merge by id like the other lanes', () {
      final b = base();
      final mine = TimelineOps.addSfx(TimelineOps.addEffect(b, 'shake', startMs: 1000, durationMs: 400), url: 'https://cdn.test/a.mp3', startMs: 2000);
      final theirs = TimelineOps.addBroll(b, {'kind': 'stock_query', 'query': 'gym', 'url': null}, startMs: 3000);
      final r = merge(b, mine, theirs);
      expect(r.ir.effects, hasLength(1));
      expect(r.ir.audio.sfx, hasLength(1));
      expect(r.ir.overlays, hasLength(1));
    });

    test('music: Director changes the level, creator added a title: both apply', () {
      final b = TimelineOps.setMusic(base(), url: 'https://cdn.test/song.mp3', title: 'Song', volumeDb: -12);
      final mine = TimelineOps.addText(b, 'T', startMs: 0, durationMs: 500);
      final theirs = TimelineOps.updateMusic(b, volumeDb: -22);
      final r = merge(b, mine, theirs);
      expect(r.ir.audio.music.single.volumeDb, -22);
      expect(r.ir.audio.music.single.source['url'], 'https://cdn.test/song.mp3');
      expect(r.ir.captions, hasLength(1));
    });
  });

  group('scalars', () {
    test('original sound level: the side that changed it', () {
      final b = base();
      final r = merge(b, TimelineOps.addZoom(b, startMs: 1000), TimelineOps.setOriginalVolume(b, -6));
      expect(r.ir.audio.originalVolumeDb, -6);
    });

    test('both changed the original sound level: the creator value, with a note', () {
      final b = base();
      final r = merge(b, TimelineOps.setOriginalVolume(b, -3), TimelineOps.setOriginalVolume(b, -12));
      expect(r.ir.audio.originalVolumeDb, -3);
      expect(r.conflicts, isNotEmpty);
    });
  });

  group('main clips', () {
    test('only the Director cut: its cuts are taken', () {
      final b = base();
      final r = merge(b, TimelineOps.addZoom(b, startMs: 1000), TimelineOps.removeRange(b, 5000, 10000));
      expect(r.ir.durationMs, 5000);
      expect(r.structuralConflict, isFalse);
      r.ir.validate();
    });

    test('only the creator cut: the creator cuts stay and the Director items are added', () {
      final b = base();
      final mine = TimelineOps.removeRange(b, 8000, 10000);
      final r = merge(b, mine, TimelineOps.addText(b, 'Hook', startMs: 0, durationMs: 1000));
      expect(r.ir.durationMs, 8000);
      expect(r.ir.captions.single.text, 'Hook');
      r.ir.validate();
    });

    test('both cut: structural conflict, nothing merged, the creator timeline is returned', () {
      final b = base();
      final mine = TimelineOps.removeRange(b, 0, 1000);
      final r = merge(b, mine, TimelineOps.removeRange(b, 5000, 10000));
      expect(r.structuralConflict, isTrue);
      expect(identical(r.ir, mine), isTrue);
    });

    test("a title the creator added after the request is re-timed through the Director's cut", () {
      final b = base();
      // The Director cut 0-2 s; the creator meanwhile put a title at 5-6 s (old timeline).
      final theirs = TimelineOps.removeRange(b, 0, 2000);
      final mine = TimelineOps.addText(b, 'Later', startMs: 5000, durationMs: 1000);
      final r = merge(b, mine, theirs);
      final t = r.ir.captions.single;
      expect(t.startMs, 3000);
      expect(t.endMs, 4000);
      r.ir.validate();
    });

    test('a new item that started inside the cut moves to the next moment that still exists, and keeps its length', () {
      final b = base();
      final theirs = TimelineOps.removeRange(b, 2000, 4000);
      final mine = TimelineOps.addZoom(b, startMs: 2500, durationMs: 1000);
      final z = merge(b, mine, theirs).ir.zooms.single;
      expect(z.startMs, 2000);
      expect(z.endMs - z.startMs, greaterThan(0));
    });

    test('items the creator added past the new end are pulled inside, not lost', () {
      final b = base();
      final theirs = TimelineOps.removeRange(b, 5000, 10000);
      final mine = TimelineOps.addText(b, 'End card', startMs: 9000, durationMs: 1000);
      final r = merge(b, mine, theirs);
      expect(r.ir.captions, hasLength(1));
      expect(r.ir.captions.single.endMs, lessThanOrEqualTo(r.ir.durationMs));
    });

    test('sources: the union of both sides', () {
      final b = base();
      final theirs = b.copyWith(sources: [...b.sources, EditIrSource(assetId: 'stock1', durationMs: 4000, width: 1080, height: 1920)]);
      final mine = TimelineOps.addZoom(b, startMs: 1000);
      expect(merge(b, mine, theirs).ir.sources.map((s) => s.assetId), containsAll(['primary', 'stock1']));
    });
  });
}
