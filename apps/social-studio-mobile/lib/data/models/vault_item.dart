import 'package:flutter/material.dart';
import '../../core/util/json.dart';

enum VaultItemType {
  video,
  image,
  document,
  note;

  static VaultItemType fromString(String? val) {
    return switch (val?.toLowerCase()) {
      'video' => VaultItemType.video,
      'image' => VaultItemType.image,
      'document' => VaultItemType.document,
      'note' => VaultItemType.note,
      _ => VaultItemType.note,
    };
  }
}

enum VaultNoteCategory {
  hook,
  hashtag,
  script,
  keyword,
  general;

  String get label => switch (this) {
        VaultNoteCategory.hook => 'Hook',
        VaultNoteCategory.hashtag => 'Hashtags',
        VaultNoteCategory.script => 'Script',
        VaultNoteCategory.keyword => 'Keywords',
        VaultNoteCategory.general => 'Note',
      };

  Color get color => switch (this) {
        VaultNoteCategory.hook => const Color(0xFFF59E0B), // Amber
        VaultNoteCategory.hashtag => const Color(0xFF06B6D4), // Cyan
        VaultNoteCategory.script => const Color(0xFF10B981), // Emerald
        VaultNoteCategory.keyword => const Color(0xFF8B5CF6), // Purple
        VaultNoteCategory.general => const Color(0xFF94A3B8), // Slate
      };

  static VaultNoteCategory fromString(String? val) {
    return switch (val?.toLowerCase()) {
      'hook' => VaultNoteCategory.hook,
      'hashtag' => VaultNoteCategory.hashtag,
      'script' => VaultNoteCategory.script,
      'keyword' => VaultNoteCategory.keyword,
      _ => VaultNoteCategory.general,
    };
  }
}

class VaultFolder {
  VaultFolder({
    required this.id,
    required this.name,
    this.colorValue = 0xFF4F46E5, // Default Indigo
    this.parentId,
    DateTime? createdAt,
    DateTime? updatedAt,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  final String id;
  final String name;
  final int colorValue;
  final String? parentId;
  final DateTime createdAt;
  final DateTime updatedAt;

  Color get color => Color(colorValue);

  VaultFolder copyWith({
    String? name,
    int? colorValue,
    String? parentId,
  }) =>
      VaultFolder(
        id: id,
        name: name ?? this.name,
        colorValue: colorValue ?? this.colorValue,
        parentId: parentId ?? this.parentId,
        createdAt: createdAt,
        updatedAt: DateTime.now(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'colorValue': colorValue,
        'parentId': parentId,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory VaultFolder.fromJson(Json j) => VaultFolder(
        id: jStrOr(j['id'], ''),
        name: jStrOr(j['name'], 'Untitled folder'),
        colorValue: jInt(j['colorValue']) ?? 0xFF4F46E5,
        parentId: jStr(j['parentId']),
        createdAt: jDate(j['createdAt']),
        updatedAt: jDate(j['updatedAt']),
      );
}

class VaultItem {
  VaultItem({
    required this.id,
    this.folderId,
    required this.name,
    required this.type,
    this.localPath,
    this.fileSizeBytes = 0,
    this.durationMs = 0,
    this.noteContent,
    this.noteCategory = VaultNoteCategory.general,
    this.tags = const [],
    this.pieceId,
    this.takeIndex,
    DateTime? createdAt,
    DateTime? updatedAt,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  final String id;
  final String? folderId;
  final String name;
  final VaultItemType type;
  final String? localPath;
  final int fileSizeBytes;
  final int durationMs;
  final String? noteContent;
  final VaultNoteCategory noteCategory;
  final List<String> tags;
  /// Calendar piece this take was shot for (the piece sheet lists them as Clip 1…N).
  final String? pieceId;
  /// 1-based order of the take within its piece; the editor uses this order.
  final int? takeIndex;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get formattedSize {
    if (fileSizeBytes <= 0) return '';
    if (fileSizeBytes < 1024) return '$fileSizeBytes B';
    if (fileSizeBytes < 1024 * 1024) return '${(fileSizeBytes / 1024).toStringAsFixed(1)} KB';
    if (fileSizeBytes < 1024 * 1024 * 1024) {
      return '${(fileSizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(fileSizeBytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  String get formattedDuration {
    if (durationMs <= 0) return '';
    final totalSec = durationMs ~/ 1000;
    final min = totalSec ~/ 60;
    final sec = totalSec % 60;
    return '${min.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
  }

  VaultItem copyWith({
    String? folderId,
    String? name,
    VaultItemType? type,
    String? localPath,
    int? fileSizeBytes,
    int? durationMs,
    String? noteContent,
    VaultNoteCategory? noteCategory,
    List<String>? tags,
    String? pieceId,
    int? takeIndex,
  }) =>
      VaultItem(
        id: id,
        folderId: folderId ?? this.folderId,
        name: name ?? this.name,
        type: type ?? this.type,
        localPath: localPath ?? this.localPath,
        fileSizeBytes: fileSizeBytes ?? this.fileSizeBytes,
        durationMs: durationMs ?? this.durationMs,
        noteContent: noteContent ?? this.noteContent,
        noteCategory: noteCategory ?? this.noteCategory,
        tags: tags ?? this.tags,
        pieceId: pieceId ?? this.pieceId,
        takeIndex: takeIndex ?? this.takeIndex,
        createdAt: createdAt,
        updatedAt: DateTime.now(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'folderId': folderId,
        'name': name,
        'type': type.name,
        'localPath': localPath,
        'fileSizeBytes': fileSizeBytes,
        'durationMs': durationMs,
        'noteContent': noteContent,
        'noteCategory': noteCategory.name,
        'tags': tags,
        'pieceId': pieceId,
        'takeIndex': takeIndex,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory VaultItem.fromJson(Json j) => VaultItem(
        id: jStrOr(j['id'], ''),
        folderId: jStr(j['folderId']),
        name: jStrOr(j['name'], 'Untitled item'),
        type: VaultItemType.fromString(jStr(j['type'])),
        localPath: jStr(j['localPath']),
        fileSizeBytes: jInt(j['fileSizeBytes']) ?? 0,
        durationMs: jInt(j['durationMs']) ?? 0,
        noteContent: jStr(j['noteContent']),
        noteCategory: VaultNoteCategory.fromString(jStr(j['noteCategory'])),
        tags: jStrList(j['tags']),
        pieceId: jStr(j['pieceId']),
        takeIndex: jInt(j['takeIndex']),
        createdAt: jDate(j['createdAt']),
        updatedAt: jDate(j['updatedAt']),
      );
}
