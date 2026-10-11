import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/native_engine/edit_ir.dart';

String timecode(int ms) {
  final t = ms < 0 ? 0 : ms;
  final m = t ~/ 60000;
  final s = (t ~/ 1000) % 60;
  final f = (t % 1000) ~/ 100;
  return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}.$f';
}

/// A saved video editing draft that can be resumed at any time.
class StudioDraft {
  const StudioDraft({
    required this.id,
    required this.title,
    required this.sourcePath,
    required this.ir,
    required this.updatedAt,
    this.sourcePaths = const {},
    this.playheadMs = 0,
    this.projectId,
    this.postId,
    this.pieceId,
    this.hook,
    this.script,
    this.thumbnailUrl,
  });

  final String id;
  final String title;
  final String sourcePath;
  final Map<String, String> sourcePaths;
  final MobileEditIr ir;
  final int playheadMs;
  final DateTime updatedAt;
  final String? projectId;
  final String? postId;
  final String? pieceId;
  final String? hook;
  final String? script;
  final String? thumbnailUrl;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'sourcePath': sourcePath,
    'sourcePaths': sourcePaths,
    'ir': ir.toJson(),
    'playheadMs': playheadMs,
    'updatedAt': updatedAt.toIso8601String(),
    if (projectId != null) 'projectId': projectId,
    if (postId != null) 'postId': postId,
    if (pieceId != null) 'pieceId': pieceId,
    if (hook != null) 'hook': hook,
    if (script != null) 'script': script,
    if (thumbnailUrl != null) 'thumbnailUrl': thumbnailUrl,
  };

  factory StudioDraft.fromJson(Map<String, dynamic> json) {
    return StudioDraft(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled Draft',
      sourcePath: (json['sourcePath'] as String?) ?? '',
      sourcePaths: Map<String, String>.from((json['sourcePaths'] as Map?) ?? {}),
      ir: MobileEditIr.fromJson(Map<String, dynamic>.from(json['ir'] as Map)),
      playheadMs: (json['playheadMs'] as num?)?.toInt() ?? 0,
      updatedAt: DateTime.tryParse((json['updatedAt'] as String?) ?? '') ?? DateTime.now(),
      projectId: json['projectId'] as String?,
      postId: json['postId'] as String?,
      pieceId: json['pieceId'] as String?,
      hook: json['hook'] as String?,
      script: json['script'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );
  }
}

/// Manages persistent video studio drafts in local storage.
class StudioDraftsNotifier extends StateNotifier<List<StudioDraft>> {
  StudioDraftsNotifier() : super([]) {
    _load();
  }

  static const _storageKey = 'studio_video_drafts_v1';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_storageKey);
      if (raw == null || raw.isEmpty) {
        state = [];
        return;
      }
      final decoded = jsonDecode(raw) as List;
      final drafts = <StudioDraft>[];
      for (final item in decoded) {
        try {
          if (item is Map) {
            drafts.add(StudioDraft.fromJson(Map<String, dynamic>.from(item)));
          }
        } catch (_) {
          // Ignore individual corrupted drafts
        }
      }
      drafts.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      state = drafts;
    } catch (_) {
      state = [];
    }
  }

  Future<void> save(StudioDraft draft) async {
    final list = [...state];
    final idx = list.indexWhere((d) => d.id == draft.id);
    if (idx >= 0) {
      list[idx] = draft;
    } else {
      list.insert(0, draft);
    }
    list.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    state = list;
    await _persist(list);
  }

  Future<void> delete(String draftId) async {
    final list = state.where((d) => d.id != draftId).toList();
    state = list;
    await _persist(list);
  }

  StudioDraft? getById(String id) {
    return state.where((d) => d.id == id).firstOrNull;
  }

  Future<void> _persist(List<StudioDraft> list) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final encoded = jsonEncode(list.map((d) => d.toJson()).toList());
      await prefs.setString(_storageKey, encoded);
    } catch (_) {}
  }
}

final studioDraftsProvider = StateNotifierProvider<StudioDraftsNotifier, List<StudioDraft>>((ref) {
  return StudioDraftsNotifier();
});
