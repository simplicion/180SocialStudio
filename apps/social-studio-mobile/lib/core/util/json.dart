/// Defensive JSON readers. The backend is JavaScript: numbers arrive as strings, arrays as
/// JSON-encoded strings, and optional objects as null. These helpers never invent values —
/// a missing field is null/empty, not a plausible-looking default.
library;

import 'dart:convert';

typedef Json = Map<String, dynamic>;

String? jStr(Object? v) {
  if (v == null) return null;
  if (v is String) return v;
  return v.toString();
}

String jStrOr(Object? v, String fallback) => jStr(v) ?? fallback;

int? jInt(Object? v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.toInt();
  return null;
}

double? jDouble(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

bool jBool(Object? v, [bool fallback = false]) {
  if (v is bool) return v;
  if (v is String) return v == 'true' || v == '1';
  if (v is num) return v != 0;
  return fallback;
}

DateTime? jDate(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  if (v is int) return DateTime.fromMillisecondsSinceEpoch(v);
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v)?.toLocal();
  return null;
}

Json jMap(Object? v) {
  if (v is Map) return v.cast<String, dynamic>();
  if (v is String && v.trim().startsWith('{')) {
    try {
      final d = jsonDecode(v);
      if (d is Map) return d.cast<String, dynamic>();
    } catch (_) {}
  }
  return <String, dynamic>{};
}

Json? jMapOrNull(Object? v) => v is Map ? v.cast<String, dynamic>() : null;

List<Object?> _asList(Object? v) {
  if (v is List) return v;
  if (v is String && v.trim().startsWith('[')) {
    try {
      final d = jsonDecode(v);
      if (d is List) return d;
    } catch (_) {}
  }
  return [];
}

List<String> jStrList(Object? v) {
  if (v is String && !v.trim().startsWith('[')) {
    return v.split(RegExp(r'[,\n]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
  }
  return _asList(v).where((e) => e != null).map((e) => e.toString()).toList();
}

List<T> jList<T>(Object? v, T Function(Json) parse) =>
    _asList(v).whereType<Map>().map((m) => parse(m.cast<String, dynamic>())).toList();

/// Removes null values so PUT/POST bodies only carry what the user set.
Json compact(Json m) => Map.fromEntries(m.entries.where((e) => e.value != null));

String? isoOrNull(DateTime? d) => d?.toUtc().toIso8601String();
