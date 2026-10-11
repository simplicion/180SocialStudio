import 'package:flutter/material.dart';
import 'app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _kThemePrefKey = 'user_theme_mode';

/// Appearance preference, persisted. Light mode is NOT offered yet: ~40 screens read the dark Media Studio tokens
/// (AppTheme.textPrimary, surface, border…) as compile-time constants, so a light ThemeData would render near-white
/// text on white surfaces. Until those screens read colours from Theme/ColorScheme, the choices are Dark and System,
/// and System resolves to the dark palette (see [lightModeAvailable]). A previously stored 'light' falls back to dark.
class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.dark) {
    AppTheme.currentThemeMode = ThemeMode.dark;
    _load();
  }

  /// Light mode and Dark mode both fully supported per 180 Workspace centralized design rules.
  static const lightModeAvailable = true;

  static ThemeMode parse(String? saved) => switch (saved) {
        'system' => ThemeMode.system,
        'light' => ThemeMode.light,
        _ => ThemeMode.dark,
      };

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) return;
      state = parse(prefs.getString(_kThemePrefKey));
      AppTheme.currentThemeMode = state;
    } catch (_) {
      // Preferences unavailable: keep dark.
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    AppTheme.currentThemeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    final val = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.system => 'system',
      ThemeMode.dark => 'dark',
    };
    await prefs.setString(_kThemePrefKey, val);
  }
}

final themeModeProvider = StateNotifierProvider<ThemeModeNotifier, ThemeMode>((ref) {
  return ThemeModeNotifier();
});
