import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/brand_voice.dart';

/// Curated designer color palette for one-tap visual brand styling.
class BrandColorOption {
  const BrandColorOption({
    required this.name,
    required this.hex,
    required this.color,
  });

  final String name;
  final String hex;
  final Color color;
}

const brandPalette = [
  BrandColorOption(name: 'Deep Indigo', hex: '#4F46E5', color: Color(0xFF4F46E5)),
  BrandColorOption(name: 'Electric Blue', hex: '#2563EB', color: Color(0xFF2563EB)),
  BrandColorOption(name: 'Cyber Cyan', hex: '#06B6D4', color: Color(0xFF06B6D4)),
  BrandColorOption(name: 'Royal Violet', hex: '#7C3AED', color: Color(0xFF7C3AED)),
  BrandColorOption(name: 'Vivid Purple', hex: '#9333EA', color: Color(0xFF9333EA)),
  BrandColorOption(name: 'Neon Fuchsia', hex: '#D946EF', color: Color(0xFFD946EF)),
  BrandColorOption(name: 'Crimson Rose', hex: '#E11D48', color: Color(0xFFE11D48)),
  BrandColorOption(name: 'Bold Red', hex: '#DC2626', color: Color(0xFFDC2626)),
  BrandColorOption(name: 'Sunset Coral', hex: '#F97316', color: Color(0xFFF97316)),
  BrandColorOption(name: 'Warm Amber', hex: '#D97706', color: Color(0xFFD97706)),
  BrandColorOption(name: 'Golden Sun', hex: '#EAB308', color: Color(0xFFEAB308)),
  BrandColorOption(name: 'Emerald Growth', hex: '#059669', color: Color(0xFF059669)),
  BrandColorOption(name: 'Mint Jade', hex: '#10B981', color: Color(0xFF10B981)),
  BrandColorOption(name: 'Teal Modern', hex: '#0D9488', color: Color(0xFF0D9488)),
  BrandColorOption(name: 'Navy Midnight', hex: '#1E3A8A', color: Color(0xFF1E3A8A)),
  BrandColorOption(name: 'Obsidian Slate', hex: '#0F172A', color: Color(0xFF0F172A)),
  BrandColorOption(name: 'Charcoal Grey', hex: '#334155', color: Color(0xFF334155)),
  BrandColorOption(name: 'Silver Mist', hex: '#64748B', color: Color(0xFF64748B)),
  BrandColorOption(name: 'Terracotta', hex: '#C2410C', color: Color(0xFFC2410C)),
  BrandColorOption(name: 'Lime Energy', hex: '#65A30D', color: Color(0xFF65A30D)),
];

/// Strategic brand identity form for Social Studio.
/// Gives AI high-leverage context (brand type, niche, elevator pitch, growth goal, voice)
/// and visual assets (logo/profile photo, max 2 visual colors selected via tactile swatches).
class BrandVoiceForm extends StatefulWidget {
  const BrandVoiceForm({
    super.key,
    required this.initial,
    required this.onChanged,
    this.onUploadLogo,
    this.onLogoPicked,
  });

  final BrandVoice initial;
  final ValueChanged<BrandVoice> onChanged;
  final VoidCallback? onUploadLogo;
  final ValueChanged<String?>? onLogoPicked;

  @override
  State<BrandVoiceForm> createState() => _BrandVoiceFormState();
}

class _BrandVoiceFormState extends State<BrandVoiceForm> {
  late String _brandType = widget.initial.brandType ?? 'creator';
  late final _industry = TextEditingController(text: widget.initial.industry ?? '');
  late final _mission = TextEditingController(text: widget.initial.mission ?? '');
  late String? _primaryGoal = widget.initial.primaryGoal;

  late final _tone = TextEditingController(text: widget.initial.tone);
  late final _audience = TextEditingController(text: widget.initial.targetAudience);
  late final _pillars = TextEditingController(text: widget.initial.contentPillars.join(', '));
  late final _forbidden = TextEditingController(text: widget.initial.forbiddenWords.join(', '));

  late String? _primaryColorHex = widget.initial.primaryColor;
  late String? _accentColorHex = widget.initial.accentColor;

  String? _localLogoPath;

  @override
  void dispose() {
    _industry.dispose();
    _mission.dispose();
    _tone.dispose();
    _audience.dispose();
    _pillars.dispose();
    _forbidden.dispose();
    super.dispose();
  }

  void _emit() {
    widget.onChanged(widget.initial.copyWith(
      brandType: _brandType,
      industry: _industry.text.trim().isEmpty ? null : _industry.text.trim(),
      mission: _mission.text.trim().isEmpty ? null : _mission.text.trim(),
      primaryGoal: _primaryGoal,
      tone: _tone.text.trim(),
      targetAudience: _audience.text.trim(),
      contentPillars: splitList(_pillars.text),
      forbiddenWords: splitList(_forbidden.text),
      primaryColor: _primaryColorHex,
      accentColor: _accentColorHex,
    ));
  }

  Color? _parseColor(String? hex) {
    if (hex == null) return null;
    final clean = hex.replaceAll('#', '').trim();
    if (clean.length == 6) {
      final val = int.tryParse('FF$clean', radix: 16);
      if (val != null) return Color(val);
    }
    return null;
  }

  Future<void> _pickImage() async {
    if (widget.onUploadLogo != null) {
      widget.onUploadLogo!();
      return;
    }
    try {
      final picker = ImagePicker();
      final file = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 85,
      );
      if (file == null || !mounted) return;
      setState(() {
        _localLogoPath = file.path;
      });
      widget.onLogoPicked?.call(file.path);
      _emit();
    } catch (e) {
      if (mounted) showError(context, 'Could not select image: $e');
    }
  }

  void _clearImage() {
    setState(() {
      _localLogoPath = null;
    });
    widget.onLogoPicked?.call(null);
    widget.onChanged(widget.initial.copyWith(logoUrl: null));
  }

  void _openColorPicker({required bool isPrimary}) {
    final currentColorHex = isPrimary ? _primaryColorHex : _accentColorHex;

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(20, 12, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppTheme.border,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                SizedBox(height: 16),
                Row(
                  children: [
                    Container(
                      width: 12,
                      height: 12,
                      margin: EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        color: isPrimary ? AppTheme.primary : AppTheme.accent,
                        shape: BoxShape.circle,
                      ),
                    ),
                    Text(
                      'Select ${isPrimary ? "Primary" : "Accent"} Color',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    Spacer(),
                    if (currentColorHex != null)
                      TextButton(
                        onPressed: () {
                          Navigator.pop(ctx);
                          setState(() {
                            if (isPrimary) {
                              _primaryColorHex = null;
                            } else {
                              _accentColorHex = null;
                            }
                          });
                          _emit();
                        },
                        child: Text('Clear', style: TextStyle(color: AppTheme.error)),
                      ),
                  ],
                ),
                Text(
                  'Visual colors guide video subtitles, b-roll overlays, and brand graphics. Tap a swatch to apply.',
                  style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                ),
                SizedBox(height: 16),
                ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: 320),
                  child: GridView.builder(
                    shrinkWrap: true,
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 4,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 10,
                      childAspectRatio: 1.05,
                    ),
                    itemCount: brandPalette.length,
                    itemBuilder: (context, i) {
                      final item = brandPalette[i];
                      final isSelected = currentColorHex?.toUpperCase() == item.hex.toUpperCase();

                      return InkWell(
                        onTap: () {
                          Navigator.pop(ctx);
                          setState(() {
                            if (isPrimary) {
                              _primaryColorHex = item.hex;
                            } else {
                              _accentColorHex = item.hex;
                            }
                          });
                          _emit();
                        },
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          decoration: BoxDecoration(
                            color: AppTheme.surfaceElevated,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSelected ? AppTheme.primary : AppTheme.border,
                              width: isSelected ? 2 : 1,
                            ),
                          ),
                          padding: EdgeInsets.all(6),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                width: 28,
                                height: 28,
                                decoration: BoxDecoration(
                                  color: item.color,
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: item.color.withValues(alpha: 0.35),
                                      blurRadius: 6,
                                      offset: Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: isSelected
                                    ? Icon(Icons.check_rounded, color: Colors.white, size: 16)
                                    : null,
                              ),
                              SizedBox(height: 4),
                              Text(
                                item.name,
                                textAlign: TextAlign.center,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                  color: isSelected ? AppTheme.textPrimary : AppTheme.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildColorSelectorCard({
    required String title,
    required String? hex,
    required bool isPrimary,
  }) {
    final parsed = _parseColor(hex);
    final hasColor = parsed != null;

    return Expanded(
      child: InkWell(
        onTap: () => _openColorPicker(isPrimary: isPrimary),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: AppTheme.surfaceElevated,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: hasColor ? parsed.withValues(alpha: 0.5) : AppTheme.border,
              width: hasColor ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: parsed ?? (isPrimary ? AppTheme.primary.withValues(alpha: 0.2) : AppTheme.accent.withValues(alpha: 0.2)),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.2),
                    width: 1.5,
                  ),
                  boxShadow: hasColor
                      ? [
                          BoxShadow(
                            color: parsed.withValues(alpha: 0.4),
                            blurRadius: 6,
                            offset: Offset(0, 2),
                          ),
                        ]
                      : null,
                ),
                child: !hasColor
                    ? Icon(
                        Icons.palette_outlined,
                        size: 16,
                        color: AppTheme.textSecondary,
                      )
                    : null,
              ),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      hasColor ? hex! : 'Tap to select',
                      style: TextStyle(
                        fontSize: 11,
                        color: hasColor ? AppTheme.textPrimary : AppTheme.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.textMuted, size: 18),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController c, String label, {String? hint, int maxLines = 1, String? helper}) => Padding(
        padding: EdgeInsets.only(bottom: 14),
        child: TextField(
          controller: c,
          maxLines: maxLines,
          minLines: 1,
          onChanged: (_) => _emit(),
          decoration: fieldDecoration(label, hint: hint, helper: helper),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final hasRemoteLogo = widget.initial.logoUrl != null && widget.initial.logoUrl!.isNotEmpty;
    final hasLocalLogo = _localLogoPath != null && _localLogoPath!.isNotEmpty;
    final hasImage = hasRemoteLogo || hasLocalLogo;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // 1. Brand Logo or Profile Photo
        SectionCard(
          child: Row(
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(
                  color: AppTheme.surfaceElevated,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppTheme.border),
                ),
                clipBehavior: Clip.antiAlias,
                child: hasLocalLogo
                    ? (kIsWeb
                        ? Image.network(_localLogoPath!, fit: BoxFit.cover)
                        : Image.file(File(_localLogoPath!), fit: BoxFit.cover))
                    : hasRemoteLogo
                        ? Image.network(widget.initial.logoUrl!, fit: BoxFit.cover)
                        : Icon(
                            _brandType == 'creator' ? Icons.account_circle_outlined : Icons.business_rounded,
                            color: AppTheme.textSecondary,
                            size: 30,
                          ),
              ),
              SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _brandType == 'creator' ? 'Profile Picture or Logo' : 'Brand Logo',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    SizedBox(height: 2),
                    Text(
                      hasImage ? 'Visual identity asset ready' : 'Upload company logo or creator headshot (PNG, JPG)',
                      style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                    ),
                  ],
                ),
              ),
              if (hasImage)
                IconButton(
                  onPressed: _clearImage,
                  icon: Icon(Icons.close_rounded, size: 18, color: AppTheme.textMuted),
                  tooltip: 'Remove',
                ),
              FilledButton.tonalIcon(
                onPressed: _pickImage,
                icon: Icon(Icons.upload_rounded, size: 16),
                label: Text(hasImage ? 'Change' : 'Upload'),
              ),
            ],
          ),
        ),
        SizedBox(height: 18),

        // 2. Brand Colors (Max 2: Primary & Accent) - Zero typing! Pure visual tap selection.
        SectionHeader('Brand Colors (Max 2)'),
        Text(
          'Select up to two signature colors for your video text, overlays, and graphics.',
          style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
        ),
        SizedBox(height: 8),
        Row(
          children: [
            _buildColorSelectorCard(
              title: 'Primary Color',
              hex: _primaryColorHex,
              isPrimary: true,
            ),
            SizedBox(width: 10),
            _buildColorSelectorCard(
              title: 'Accent Color',
              hex: _accentColorHex,
              isPrimary: false,
            ),
          ],
        ),
        SizedBox(height: 20),

        // 3. Brand Type (Personal Brand vs Company / Organization)
        SectionHeader('Brand Type'),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(
              value: 'creator',
              icon: Icon(Icons.person_outline_rounded),
              label: Text('Personal Brand (Creator/Founder)'),
            ),
            ButtonSegment(
              value: 'company',
              icon: Icon(Icons.business_outlined),
              label: Text('Company / Business'),
            ),
          ],
          selected: {_brandType},
          onSelectionChanged: (s) {
            setState(() => _brandType = s.first);
            _emit();
          },
        ),
        SizedBox(height: 20),

        // 4. Industry & Niche
        SectionHeader('Industry & Niche'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final ind in BrandVoice.industryPresets)
              FilterChip(
                label: Text(ind),
                selected: _industry.text.trim().toLowerCase() == ind.toLowerCase(),
                onSelected: (selected) {
                  setState(() => _industry.text = selected ? ind : '');
                  _emit();
                },
              ),
          ],
        ),
        SizedBox(height: 10),
        _field(
          _industry,
          'Custom industry / micro-niche',
          hint: 'e.g. AI Automation for Real Estate, B2B SaaS Growth',
        ),

        // 5. Core Mission / What You Do & Who You Help
        SectionHeader('What You Do & Who You Help'),
        Text(
          'This is the single most vital input for the AI Director to write high-converting scripts and content.',
          style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
        ),
        SizedBox(height: 8),
        _field(
          _mission,
          'Core proposition & elevator pitch',
          hint: _brandType == 'creator'
              ? 'e.g. I help B2B tech founders build 6-figure personal brands using organic short-form video.'
              : 'e.g. We provide fast, reliable AI logistics infrastructure for high-growth e-commerce brands.',
          maxLines: 3,
        ),

        // 6. Primary Growth Goal
        SectionHeader('Primary Social Goal'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final goal in BrandVoice.primaryGoalPresets)
              ChoiceChip(
                label: Text(goal),
                selected: _primaryGoal == goal,
                onSelected: (selected) {
                  setState(() => _primaryGoal = selected ? goal : null);
                  _emit();
                },
              ),
          ],
        ),
        SizedBox(height: 20),

        // 7. Tone of Voice
        SectionHeader('Tone of Voice'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final preset in BrandVoice.tonePresets)
              ChoiceChip(
                label: Text(preset),
                selected: _tone.text == preset,
                onSelected: (selected) {
                  setState(() => _tone.text = selected ? preset : '');
                  _emit();
                },
              ),
          ],
        ),
        SizedBox(height: 10),
        _field(
          _tone,
          'Custom tone & persona nuances',
          hint: 'e.g. Bold, punchy, authentic, contrarian with humor',
        ),

        // 8. Target Audience & Content Pillars
        SectionHeader('Target Audience & Pillars'),
        _field(
          _audience,
          'Target audience',
          hint: 'Who is your ideal viewer/buyer? (e.g. Early-stage founders, VP of Sales, gym owners)',
          maxLines: 2,
        ),
        _field(
          _pillars,
          'Content pillars / core topics',
          helper: 'Comma-separated, e.g. Daily workflows, AI experiments, Client case studies, Industry rants',
        ),
        _field(
          _forbidden,
          'Restricted words or competitor topics',
          helper: 'Comma-separated. Content mentioning these will be flagged before publishing.',
        ),
      ],
    );
  }
}
