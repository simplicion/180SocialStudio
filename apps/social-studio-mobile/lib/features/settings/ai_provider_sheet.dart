import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';

class AiProviderSheet extends ConsumerStatefulWidget {
  const AiProviderSheet({super.key, this.onSaved});

  final VoidCallback? onSaved;

  static Future<bool?> show(BuildContext context, {VoidCallback? onSaved}) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AiProviderSheet(onSaved: onSaved),
    );
  }

  @override
  ConsumerState<AiProviderSheet> createState() => _AiProviderSheetState();
}

class _AiProviderSheetState extends ConsumerState<AiProviderSheet> {
  bool _loading = true;
  bool _saving = false;
  String _selectedProvider = 'builtin';
  Map<String, dynamic> _providers = const {};
  final Map<String, TextEditingController> _controllers = {
    'gemini': TextEditingController(),
    'openai': TextEditingController(),
    'claude': TextEditingController(),
    'groq': TextEditingController(),
  };
  final Map<String, bool> _obscureText = {
    'gemini': true,
    'openai': true,
    'claude': true,
    'groq': true,
  };

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadSettings() async {
    try {
      final res = await ref.read(socialApiProvider).getAiSettings();
      if (!mounted) return;
      setState(() {
        _selectedProvider = res['aiProvider'] as String? ?? 'builtin';
        _providers = (res['providers'] as Map?)?.cast<String, dynamic>() ?? const {};
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _saveSettings() async {
    setState(() => _saving = true);
    try {
      final key = _controllers[_selectedProvider]?.text.trim();
      await ref.read(socialApiProvider).updateAiSettings(
            aiProvider: _selectedProvider,
            openaiKey: _selectedProvider == 'openai' && key != null && key.isNotEmpty ? key : null,
            geminiKey: _selectedProvider == 'gemini' && key != null && key.isNotEmpty ? key : null,
            claudeKey: _selectedProvider == 'claude' && key != null && key.isNotEmpty ? key : null,
            groqKey: _selectedProvider == 'groq' && key != null && key.isNotEmpty ? key : null,
          );
      if (!mounted) return;
      showSuccess(context, 'AI provider settings updated successfully.');
      widget.onSaved?.call();
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        showError(context, 'Failed to save settings: $e');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _openPortal(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: 24 + bottomInset,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(
          top: BorderSide(color: Theme.of(context).dividerColor),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.auto_awesome, color: AppTheme.primary, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'AI Engine & API Keys',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.bold,
                                fontSize: 18,
                              ),
                        ),
                        Text(
                          'Select your LLM intelligence provider for social calendar and creative tools.',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              if (_loading)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else ...[
                // Builtin Option
                _buildProviderTile(
                  id: 'builtin',
                  name: '180 Studio Viral AI (Zero Setup)',
                  badge: 'Recommended',
                  badgeColor: AppTheme.success,
                  description: 'Deterministic viral framework with audience psychology, hooks, and scripts. 100% reliable, zero latency, and zero token costs.',
                  icon: Icons.offline_bolt_rounded,
                ),
                const SizedBox(height: 12),

                // Gemini Option
                _buildProviderTile(
                  id: 'gemini',
                  name: 'Google Gemini 1.5 Flash / Pro',
                  badge: _isConfigured('gemini') ? 'Key Saved' : 'BYO Key',
                  badgeColor: _isConfigured('gemini') ? AppTheme.primary : AppTheme.textMuted,
                  description: 'Deep reasoning and ultra-fast multimodal performance from Google DeepMind.',
                  icon: Icons.diamond_rounded,
                  portalUrl: 'https://aistudio.google.com/app/apikey',
                  portalLabel: 'Get free key at Google AI Studio',
                ),
                const SizedBox(height: 12),

                // OpenAI Option
                _buildProviderTile(
                  id: 'openai',
                  name: 'OpenAI GPT-4o / GPT-4o-mini',
                  badge: _isConfigured('openai') ? 'Key Saved' : 'BYO Key',
                  badgeColor: _isConfigured('openai') ? AppTheme.primary : AppTheme.textMuted,
                  description: 'High-creativity language model with nuanced conversational tone.',
                  icon: Icons.psychology_rounded,
                  portalUrl: 'https://platform.openai.com/api-keys',
                  portalLabel: 'Get API key at platform.openai.com',
                ),
                const SizedBox(height: 12),

                // Claude Option
                _buildProviderTile(
                  id: 'claude',
                  name: 'Anthropic Claude 3.5 Sonnet',
                  badge: _isConfigured('claude') ? 'Key Saved' : 'BYO Key',
                  badgeColor: _isConfigured('claude') ? AppTheme.primary : AppTheme.textMuted,
                  description: 'Exceptional editorial voice, craft pacing, and natural human cadence.',
                  icon: Icons.menu_book_rounded,
                  portalUrl: 'https://console.anthropic.com/settings/keys',
                  portalLabel: 'Get API key at console.anthropic.com',
                ),
                const SizedBox(height: 12),

                // Groq Option
                _buildProviderTile(
                  id: 'groq',
                  name: 'Groq Cloud (Llama 3.3)',
                  badge: _isConfigured('groq') ? 'Key Saved' : 'BYO Key',
                  badgeColor: _isConfigured('groq') ? AppTheme.primary : AppTheme.textMuted,
                  description: 'Ultra-low latency open-weights inference engine.',
                  icon: Icons.speed_rounded,
                  portalUrl: 'https://console.groq.com/keys',
                  portalLabel: 'Get API key at console.groq.com',
                ),

                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _saveSettings,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: _saving
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Save & Apply Settings', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  bool _isConfigured(String id) {
    final p = _providers[id];
    return p is Map && p['isConfigured'] == true;
  }

  String? _keyPreview(String id) {
    final p = _providers[id];
    if (p is Map && p['keyPreview'] is String) return p['keyPreview'] as String;
    return null;
  }

  Widget _buildProviderTile({
    required String id,
    required String name,
    required String badge,
    required Color badgeColor,
    required String description,
    required IconData icon,
    String? portalUrl,
    String? portalLabel,
  }) {
    final isSelected = _selectedProvider == id;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final preview = _keyPreview(id);

    return InkWell(
      onTap: () => setState(() => _selectedProvider = id),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected
              ? AppTheme.primary.withValues(alpha: 0.08)
              : (isDark ? Colors.white.withValues(alpha: 0.04) : Colors.black.withValues(alpha: 0.02)),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? AppTheme.primary : Theme.of(context).dividerColor,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: isSelected ? AppTheme.primary : AppTheme.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    name,
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                      fontSize: 14,
                      color: isSelected ? AppTheme.primary : Theme.of(context).textTheme.bodyLarge?.color,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: badgeColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: badgeColor.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    badge,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: badgeColor),
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isSelected ? AppTheme.primary : AppTheme.textMuted,
                      width: 2,
                    ),
                    color: isSelected ? AppTheme.primary : Colors.transparent,
                  ),
                  child: isSelected
                      ? const Icon(Icons.check, size: 14, color: Colors.white)
                      : null,
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(left: 30, top: 4, right: 8),
              child: Text(
                description,
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.3),
              ),
            ),
            if (isSelected && id != 'builtin') ...[
              const SizedBox(height: 12),
              if (preview != null) ...[
                Padding(
                  padding: const EdgeInsets.only(left: 30, bottom: 8),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle_rounded, color: AppTheme.success, size: 14),
                      const SizedBox(width: 6),
                      Text(
                        'Saved Key: $preview',
                        style: TextStyle(fontSize: 11, color: AppTheme.success, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
              ],
              Padding(
                padding: const EdgeInsets.only(left: 30),
                child: TextField(
                  controller: _controllers[id],
                  obscureText: _obscureText[id] ?? true,
                  style: const TextStyle(fontSize: 13),
                  decoration: InputDecoration(
                    hintText: preview != null ? 'Enter new key to replace' : 'Paste API Key here',
                    hintStyle: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    suffixIcon: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: Icon(
                            (_obscureText[id] ?? true) ? Icons.visibility_off : Icons.visibility,
                            size: 18,
                            color: AppTheme.textMuted,
                          ),
                          onPressed: () => setState(() => _obscureText[id] = !(_obscureText[id] ?? true)),
                        ),
                        IconButton(
                          icon: Icon(Icons.content_paste, size: 18, color: AppTheme.primary),
                          onPressed: () async {
                            final data = await Clipboard.getData('text/plain');
                            if (data?.text != null && data!.text!.isNotEmpty) {
                              setState(() {
                                _controllers[id]?.text = data.text!.trim();
                              });
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (portalUrl != null && portalLabel != null) ...[
                Padding(
                  padding: const EdgeInsets.only(left: 30, top: 6),
                  child: InkWell(
                    onTap: () => _openPortal(portalUrl),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          portalLabel,
                          style: TextStyle(fontSize: 11, color: AppTheme.primary, decoration: TextDecoration.underline),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.open_in_new, size: 12, color: AppTheme.primary),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
