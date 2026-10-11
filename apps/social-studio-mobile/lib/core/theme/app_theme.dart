import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  // Global flag to track the current active mode.
  // Updated by ThemeModeNotifier.
  static ThemeMode currentThemeMode = ThemeMode.system;

  static bool get _isLight {
    if (currentThemeMode == ThemeMode.light) return true;
    if (currentThemeMode == ThemeMode.dark) return false;
    // system
    return WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.light;
  }

  // Obsidian & Zinc Tokens per .agents/rules/design-system.md
  static Color get background => _isLight ? const Color(0xFFF8FAFC) : const Color(0xFF09090B);
  static Color get surface => _isLight ? const Color(0xFFFFFFFF) : const Color(0xFF121214);
  static Color get surfaceElevated => _isLight ? const Color(0xFFF4F4F5) : const Color(0xFF18181B);
  static Color get border => _isLight ? const Color(0xFFE4E4E7) : const Color(0xFF27272A);
  static Color get borderSubtle => _isLight ? const Color(0xFFF4F4F5) : const Color(0xFF1F1F23);

  static Color get textPrimary => _isLight ? const Color(0xFF09090B) : const Color(0xFFFAFAFA);
  static Color get textSecondary => _isLight ? const Color(0xFF52525B) : const Color(0xFFA1A1AA);
  static Color get textMuted => _isLight ? const Color(0xFFA1A1AA) : const Color(0xFF71717A);

  static Color get primary => const Color(0xFF0066FF);
  static Color get accent => _isLight ? const Color(0xFF0066FF) : const Color(0xFF3B82F6);
  static Color get accentBlue => const Color(0xFF0066FF);
  
  static Color get success => const Color(0xFF10B981);
  static Color get warning => const Color(0xFFF59E0B);
  static Color get error => const Color(0xFFEF4444);

  static BoxDecoration glassCardDecoration({Color? color}) => BoxDecoration(
    color: color ?? surface,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: border),
  );

  static ThemeData get lightTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: const Color(0xFFF8FAFC),
    cardColor: const Color(0xFFFFFFFF),
    textTheme: GoogleFonts.interTextTheme(ThemeData.light().textTheme),
    colorScheme: const ColorScheme.light(
      primary: Color(0xFF0066FF),
      onPrimary: Colors.white,
      primaryContainer: Color(0xFFEFF6FF),
      onPrimaryContainer: Color(0xFF1E3A8A),
      secondary: Color(0xFF2563EB),
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFFF4F4F5),
      onSecondaryContainer: Color(0xFF09090B),
      surface: Color(0xFFFFFFFF),
      onSurface: Color(0xFF09090B),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF8FAFC),
      surfaceContainer: Color(0xFFF4F4F5),
      surfaceContainerHigh: Color(0xFFE4E4E7),
      surfaceContainerHighest: Color(0xFFD4D4D8),
      outline: Color(0xFFE4E4E7),
      outlineVariant: Color(0xFFF4F4F5),
      error: Color(0xFFEF4444),
      onError: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFFFFFFFF),
      surfaceTintColor: Colors.transparent,
      foregroundColor: Color(0xFF09090B),
      elevation: 0,
      centerTitle: true,
    ),
    dividerTheme: const DividerThemeData(
      color: Color(0xFFE4E4E7),
      thickness: 1,
      space: 1,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const Color(0xFF0066FF);
          }
          return const Color(0xFFF4F4F5);
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return Colors.white;
          }
          return const Color(0xFF52525B);
        }),
        side: WidgetStateProperty.all(const BorderSide(color: Color(0xFFE4E4E7))),
      ),
    ),
  );

  static ThemeData get darkTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: const Color(0xFF09090B),
    cardColor: const Color(0xFF121214),
    textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
    colorScheme: const ColorScheme.dark(
      primary: Color(0xFF0066FF),
      onPrimary: Colors.white,
      primaryContainer: Color(0xFF1E3A8A),
      onPrimaryContainer: Colors.white,
      secondary: Color(0xFF3B82F6),
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFF18181B), // Zinc-900 / Obsidian surface - NEVER random cyan!
      onSecondaryContainer: Color(0xFFFAFAFA),
      surface: Color(0xFF121214),
      onSurface: Color(0xFFFAFAFA),
      surfaceContainerLowest: Color(0xFF09090B),
      surfaceContainerLow: Color(0xFF0E0E10),
      surfaceContainer: Color(0xFF121214),
      surfaceContainerHigh: Color(0xFF18181B),
      surfaceContainerHighest: Color(0xFF222226),
      outline: Color(0xFF27272A),
      outlineVariant: Color(0xFF1F1F23),
      error: Color(0xFFEF4444),
      onError: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF09090B),
      surfaceTintColor: Colors.transparent,
      foregroundColor: Color(0xFFFAFAFA),
      elevation: 0,
      centerTitle: true,
    ),
    dividerTheme: const DividerThemeData(
      color: Color(0xFF27272A),
      thickness: 1,
      space: 1,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const Color(0xFF0066FF);
          }
          return const Color(0xFF18181B);
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return Colors.white;
          }
          return const Color(0xFFA1A1AA);
        }),
        side: WidgetStateProperty.all(const BorderSide(color: Color(0xFF27272A))),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: const Color(0xFF121214),
      selectedColor: const Color(0xFF18181B),
      disabledColor: const Color(0xFF09090B),
      labelStyle: const TextStyle(color: Color(0xFFFAFAFA)),
      secondaryLabelStyle: const TextStyle(color: Color(0xFFA1A1AA)),
      side: const BorderSide(color: Color(0xFF27272A)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Color(0xFF121214),
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        side: BorderSide(color: Color(0xFF27272A)),
      ),
    ),
  );
}