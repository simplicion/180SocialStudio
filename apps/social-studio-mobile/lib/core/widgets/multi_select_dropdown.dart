import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Reusable multi-select searchable dropdown with custom option creation.
/// Follows .agents/rules/design-system.md (Obsidian surfaces, zinc borders, Inter typography).
class MultiSelectDropdown extends StatefulWidget {
  const MultiSelectDropdown({
    super.key,
    required this.label,
    required this.options,
    required this.selectedValues,
    required this.onChanged,
    this.hint = 'Tap to select options...',
    this.allowCustom = true,
    this.icon,
    this.customOptionPlaceholder = 'Search or create custom...',
    this.helperText,
  });

  final String label;
  final List<String> options;
  final List<String> selectedValues;
  final ValueChanged<List<String>> onChanged;
  final String hint;
  final bool allowCustom;
  final IconData? icon;
  final String customOptionPlaceholder;
  final String? helperText;

  @override
  State<MultiSelectDropdown> createState() => _MultiSelectDropdownState();
}

class _MultiSelectDropdownState extends State<MultiSelectDropdown> {
  // Store custom items created during the session
  final List<String> _customOptions = [];

  @override
  void initState() {
    super.initState();
    // Pre-populate any selected items that aren't in preset options as custom options
    for (final val in widget.selectedValues) {
      if (!_isPreset(val) && !_customOptions.contains(val)) {
        _customOptions.add(val);
      }
    }
  }

  bool _isPreset(String val) =>
      widget.options.any((opt) => opt.trim().toLowerCase() == val.trim().toLowerCase());

  void _removeValue(String val) {
    final updated = List<String>.from(widget.selectedValues)
      ..removeWhere((item) => item.trim().toLowerCase() == val.trim().toLowerCase());
    widget.onChanged(updated);
  }

  void _openSelectionSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) {
        return _MultiSelectSheet(
          label: widget.label,
          presetOptions: widget.options,
          initialCustomOptions: _customOptions,
          initialSelectedValues: widget.selectedValues,
          allowCustom: widget.allowCustom,
          searchPlaceholder: widget.customOptionPlaceholder,
          onApply: (selected, customCreated) {
            setState(() {
              for (final c in customCreated) {
                if (!_customOptions.contains(c)) _customOptions.add(c);
              }
            });
            widget.onChanged(selected);
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasSelection = widget.selectedValues.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Trigger Card / Dropdown Field
          InkWell(
            onTap: _openSelectionSheet,
            borderRadius: BorderRadius.circular(14),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: AppTheme.surfaceElevated,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: hasSelection ? AppTheme.border : AppTheme.border,
                  width: 1.2,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.icon != null) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 2, right: 10),
                      child: Icon(widget.icon, size: 18, color: AppTheme.textSecondary),
                    ),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Label Row with count pill
                        Row(
                          children: [
                            Text(
                              widget.label,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: AppTheme.textPrimary,
                                letterSpacing: -0.2,
                              ),
                            ),
                            if (hasSelection) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                                decoration: BoxDecoration(
                                  color: AppTheme.primary.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                    color: AppTheme.primary.withValues(alpha: 0.35),
                                    width: 1,
                                  ),
                                ),
                                child: Text(
                                  '${widget.selectedValues.length} selected',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: AppTheme.primary,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 6),

                        // Tags or Placeholder
                        if (!hasSelection) ...[
                          Text(
                            widget.hint,
                            style: TextStyle(
                              fontSize: 13,
                              color: AppTheme.textMuted,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ] else ...[
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final item in widget.selectedValues)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                                  decoration: BoxDecoration(
                                    color: AppTheme.surface,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: AppTheme.border),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Flexible(
                                        child: Text(
                                          item,
                                          style: TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                            color: AppTheme.textPrimary,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      const SizedBox(width: 4),
                                      GestureDetector(
                                        onTap: () => _removeValue(item),
                                        child: Padding(
                                          padding: const EdgeInsets.all(1.0),
                                          child: Icon(
                                            Icons.close_rounded,
                                            size: 14,
                                            color: AppTheme.textMuted,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: AppTheme.textMuted,
                      size: 20,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (widget.helperText != null) ...[
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                widget.helperText!,
                style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _MultiSelectSheet extends StatefulWidget {
  const _MultiSelectSheet({
    required this.label,
    required this.presetOptions,
    required this.initialCustomOptions,
    required this.initialSelectedValues,
    required this.allowCustom,
    required this.searchPlaceholder,
    required this.onApply,
  });

  final String label;
  final List<String> presetOptions;
  final List<String> initialCustomOptions;
  final List<String> initialSelectedValues;
  final bool allowCustom;
  final String searchPlaceholder;
  final void Function(List<String> selected, List<String> customCreated) onApply;

  @override
  State<_MultiSelectSheet> createState() => _MultiSelectSheetState();
}

class _MultiSelectSheetState extends State<_MultiSelectSheet> {
  late final List<String> _selected = List<String>.from(widget.initialSelectedValues);
  late final List<String> _customList = List<String>.from(widget.initialCustomOptions);
  final TextEditingController _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  void _toggleOption(String opt) {
    setState(() {
      final exists = _selected.any((s) => s.trim().toLowerCase() == opt.trim().toLowerCase());
      if (exists) {
        _selected.removeWhere((s) => s.trim().toLowerCase() == opt.trim().toLowerCase());
      } else {
        _selected.add(opt);
      }
    });
  }

  void _addCustomOption(String custom) {
    final trimmed = custom.trim();
    if (trimmed.isEmpty) return;

    setState(() {
      final inPresets = widget.presetOptions.any((p) => p.toLowerCase() == trimmed.toLowerCase());
      if (!inPresets && !_customList.any((c) => c.toLowerCase() == trimmed.toLowerCase())) {
        _customList.insert(0, trimmed);
      }
      if (!_selected.any((s) => s.toLowerCase() == trimmed.toLowerCase())) {
        _selected.add(trimmed);
      }
      _searchCtrl.clear();
      _query = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    // Combine all available options: custom first, then presets
    final allAvailable = <String>[];
    for (final c in _customList) {
      if (!allAvailable.contains(c)) allAvailable.add(c);
    }
    for (final p in widget.presetOptions) {
      if (!allAvailable.contains(p)) allAvailable.add(p);
    }

    final filtered = _query.isEmpty
        ? allAvailable
        : allAvailable.where((item) => item.toLowerCase().contains(_query.toLowerCase())).toList();

    final showCreateButton = widget.allowCustom &&
        _query.trim().isNotEmpty &&
        !allAvailable.any((item) => item.toLowerCase() == _query.trim().toLowerCase());

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.82,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag Handle
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10, bottom: 6),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Top Header: Title, Clear, Done
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Select ${widget.label}',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppTheme.textPrimary,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ),
                  if (_selected.isNotEmpty)
                    TextButton(
                      onPressed: () => setState(() => _selected.clear()),
                      child: Text(
                        'Clear',
                        style: TextStyle(color: AppTheme.textMuted, fontSize: 13),
                      ),
                    ),
                  const SizedBox(width: 4),
                  FilledButton(
                    onPressed: () {
                      widget.onApply(_selected, _customList);
                      Navigator.pop(context);
                    },
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      minimumSize: const Size(60, 36),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),

            // Search & Custom Input Field
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: TextField(
                controller: _searchCtrl,
                autofocus: false,
                onChanged: (q) => setState(() => _query = q),
                onSubmitted: (val) {
                  if (widget.allowCustom && val.trim().isNotEmpty) {
                    _addCustomOption(val.trim());
                  }
                },
                decoration: InputDecoration(
                  hintText: widget.searchPlaceholder,
                  hintStyle: TextStyle(fontSize: 13, color: AppTheme.textMuted),
                  prefixIcon: Icon(Icons.search_rounded, size: 20, color: AppTheme.textMuted),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: Icon(Icons.close_rounded, size: 16, color: AppTheme.textMuted),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() => _query = '');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppTheme.surfaceElevated,
                  contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: AppTheme.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: AppTheme.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: AppTheme.primary, width: 1.5),
                  ),
                ),
              ),
            ),

            // "+ Add Custom Option" action banner when typing new term
            if (showCreateButton)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: InkWell(
                  onTap: () => _addCustomOption(_query),
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: AppTheme.primary.withValues(alpha: 0.35),
                        width: 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.add_circle_outline_rounded, color: AppTheme.primary, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Add "$_query" as custom option',
                            style: TextStyle(
                              color: AppTheme.primary,
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Icon(Icons.arrow_forward_rounded, color: AppTheme.primary, size: 16),
                      ],
                    ),
                  ),
                ),
              ),

            // Scrollable List of Options
            Expanded(
              child: filtered.isEmpty && !showCreateButton
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'No matching options.\nType above to create a custom entry.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 13, color: AppTheme.textMuted),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      itemCount: filtered.length,
                      separatorBuilder: (_, index) => Divider(
                        color: AppTheme.borderSubtle,
                        height: 1,
                      ),
                      itemBuilder: (context, index) {
                        final item = filtered[index];
                        final isSelected = _selected.any(
                          (s) => s.trim().toLowerCase() == item.trim().toLowerCase(),
                        );
                        final isCustom = _customList.any(
                          (c) => c.trim().toLowerCase() == item.trim().toLowerCase(),
                        );

                        return InkWell(
                          onTap: () => _toggleOption(item),
                          borderRadius: BorderRadius.circular(10),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                            child: Row(
                              children: [
                                // Custom Obsidian Checkbox
                                Container(
                                  width: 20,
                                  height: 20,
                                  decoration: BoxDecoration(
                                    color: isSelected ? AppTheme.primary : Colors.transparent,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(
                                      color: isSelected ? AppTheme.primary : AppTheme.border,
                                      width: 1.5,
                                    ),
                                  ),
                                  child: isSelected
                                      ? const Icon(
                                          Icons.check_rounded,
                                          size: 14,
                                          color: Colors.white,
                                        )
                                      : null,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    item,
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                      color: isSelected ? AppTheme.textPrimary : AppTheme.textSecondary,
                                    ),
                                  ),
                                ),
                                if (isCustom)
                                  Container(
                                    margin: const EdgeInsets.only(left: 6),
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppTheme.surfaceElevated,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: AppTheme.border),
                                    ),
                                    child: Text(
                                      'Custom',
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: AppTheme.textMuted,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),

            // Bottom Footer
            Container(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 16),
              decoration: BoxDecoration(
                color: AppTheme.surfaceElevated,
                border: Border(top: BorderSide(color: AppTheme.border)),
              ),
              child: Row(
                children: [
                  Text(
                    '${_selected.length} selected',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: () {
                      widget.onApply(_selected, _customList);
                      Navigator.pop(context);
                    },
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: const Text('Apply Selection', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
