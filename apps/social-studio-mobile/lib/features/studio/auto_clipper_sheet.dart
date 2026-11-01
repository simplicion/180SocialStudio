import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/vault_item.dart';
import '../library/vault_provider.dart';
import '../projects/project_provider.dart';

/// Shows the dedicated, studio-grade Auto Clipper modal sheet.
void showAutoClipperStudioSheet(BuildContext context, {String? projectId, String? initialUrl}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: AutoClipperStudioSheet(projectId: projectId, initialUrl: initialUrl),
    ),
  );
}

class AutoClipperStudioSheet extends ConsumerStatefulWidget {
  const AutoClipperStudioSheet({super.key, this.projectId, this.initialUrl});
  final String? projectId;
  final String? initialUrl;

  @override
  ConsumerState<AutoClipperStudioSheet> createState() => _AutoClipperStudioSheetState();
}

class _AutoClipperStudioSheetState extends ConsumerState<AutoClipperStudioSheet> {
  late final TextEditingController _urlController;

  // Customization Options
  int _clipCount = 3;
  int _targetDurationSec = 45;
  String _aspectRatio = '9:16';
  String _subtitleStyle = 'hormozi-yellow';
  String _musicMood = 'upbeat';
  bool _includeMotionGraphics = true;

  // State Machine
  bool _fetchingMeta = false;
  bool _isProcessing = false;
  int _currentStepIndex = 0;
  String? _error;
  Map<String, dynamic>? _metadata;
  List<Map<String, dynamic>> _generatedShorts = [];

  final List<String> _processingSteps = [
    'Harvesting audio & stream via yt-dlp...',
    'Transcribing dialogue with 100% Local Whisper ONNX...',
    'Scoring speech peaks & viral retention moments...',
    'Compiling single-pass FFmpeg hardware crop & kinetic subtitles...',
  ];

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.initialUrl ?? '');
    if (widget.initialUrl != null && widget.initialUrl!.isNotEmpty) {
      _fetchMetadata();
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _pasteClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null && data!.text!.trim().isNotEmpty) {
      _urlController.text = data.text!.trim();
      _fetchMetadata();
    }
  }

  Future<void> _fetchMetadata() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;

    setState(() {
      _fetchingMeta = true;
      _error = null;
      _metadata = null;
    });

    try {
      final client = ref.read(apiClientProvider);
      final res = await client.get('/api/v1/media-editor/ingest/metadata?url=${Uri.encodeComponent(url)}');
      if (res['success'] == true && res['metadata'] != null) {
        setState(() {
          _metadata = Map<String, dynamic>.from(res['metadata'] as Map);
          _fetchingMeta = false;
        });
      } else {
        setState(() {
          _error = res['message']?.toString() ?? 'Unable to resolve video details.';
          _fetchingMeta = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _fetchingMeta = false;
      });
    }
  }

  Future<void> _runAutoClipper() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;

    setState(() {
      _isProcessing = true;
      _currentStepIndex = 0;
      _error = null;
      _generatedShorts = [];
    });

    // Simulate progressive telemetry steps
    final ticker = Stream.periodic(const Duration(milliseconds: 1400), (i) => i + 1).listen((step) {
      if (mounted && step < _processingSteps.length) {
        setState(() => _currentStepIndex = step);
      }
    });

    try {
      final client = ref.read(apiClientProvider);
      final res = await client.post(
        '/api/v1/media-editor/ingest/auto-clip',
        body: {
          'url': url,
          'maxShorts': _clipCount,
          'targetShortDurationSec': _targetDurationSec,
          'aspectRatio': _aspectRatio,
          'subtitleStyle': _subtitleStyle,
          'backgroundMusic': _musicMood,
          'includeMotionGraphics': _includeMotionGraphics,
          'sync': true,
        },
      );

      await ticker.cancel();

      if (res['success'] == true && res['result'] != null) {
        final result = res['result'] as Map<String, dynamic>;
        final shorts = (result['shorts'] as List?)?.whereType<Map<String, dynamic>>().toList() ?? [];

        setState(() {
          _isProcessing = false;
          _generatedShorts = shorts;
        });

        // Also save to Project Vault in background for library access
        for (final s in shorts) {
          final title = s['title']?.toString() ?? 'Viral Short';
          final localPath = s['videoPath']?.toString();
          final durSec = (s['durationSec'] as num?)?.toInt() ?? _targetDurationSec;

          await ref.read(vaultItemsProvider.notifier).addItem(
            name: title,
            type: VaultItemType.video,
            localPath: localPath,
            durationMs: durSec * 1000,
            tags: ['auto-clipper', _aspectRatio, 'short', 'viral'],
          );
        }
      } else {
        setState(() {
          _error = res['message']?.toString() ?? 'Auto-clip operation encountered an issue.';
          _isProcessing = false;
        });
      }
    } catch (e) {
      await ticker.cancel();
      setState(() {
        _error = e.toString();
        _isProcessing = false;
      });
    }
  }

  void _postDirectlyToPlatforms(Map<String, dynamic> short) {
    final activeProject = ref.read(activeProjectProvider).valueOrNull;
    final projId = widget.projectId ?? activeProject?.id ?? '';
    final title = short['title']?.toString() ?? 'Viral Short';
    final hook = short['hookText']?.toString() ?? '';
    final videoMedia = short['videoUrl']?.toString() ?? short['videoPath']?.toString() ?? '';

    final prefill = {
      'title': title,
      'content': '$hook\n\n#Shorts #Reels #Growth #ContentCreation',
      'hook': hook,
      'mediaUrls': [videoMedia],
      'platforms': ['instagram', 'youtube', 'facebook', 'linkedin'],
    };

    Navigator.of(context).pop();

    context.push(
      '/posts/new${projId.isNotEmpty ? '?projectId=$projId' : ''}',
      extra: prefill,
    );
  }

  void _openInVideoStudio(Map<String, dynamic> short) {
    Navigator.of(context).pop();
    context.push('/studio');
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.88,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag Handle
          const SizedBox(height: 10),
          Center(
            child: Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.primary, AppTheme.accent],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.movie_filter_rounded, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '180 Auto Clipper',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        'Convert long videos into viral 9:16 shorts in 1 click',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded, size: 20),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 16),

          // Scrollable Body
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              child: _isProcessing
                  ? _buildProcessingView()
                  : _generatedShorts.isNotEmpty
                      ? _buildResultsView()
                      : _buildInputAndCustomizationView(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInputAndCustomizationView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Supported platform pills
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _platformPill('YouTube', Icons.play_arrow_rounded, const Color(0xFFFF0000)),
            const SizedBox(width: 6),
            _platformPill('Instagram', Icons.camera_alt_rounded, const Color(0xFFE4405F)),
            const SizedBox(width: 6),
            _platformPill('Facebook', Icons.facebook_rounded, const Color(0xFF1877F2)),
            const SizedBox(width: 6),
            _platformPill('LinkedIn', Icons.work_rounded, const Color(0xFF0A66C2)),
          ],
        ),
        const SizedBox(height: 14),

        // URL Input
        TextField(
          controller: _urlController,
          decoration: InputDecoration(
            labelText: 'Paste Video URL',
            hintText: 'https://youtube.com/watch?v=... or Reel/Post link',
            prefixIcon: const Icon(Icons.link_rounded),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_fetchingMeta)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                else
                  IconButton(
                    icon: const Icon(Icons.content_paste_rounded, size: 20),
                    tooltip: 'Paste from clipboard',
                    onPressed: _pasteClipboard,
                  ),
                IconButton(
                  icon: const Icon(Icons.search_rounded, size: 20),
                  tooltip: 'Fetch Info',
                  onPressed: _fetchMetadata,
                ),
              ],
            ),
          ),
          onSubmitted: (_) => _fetchMetadata(),
        ),

        // Metadata Card Preview
        if (_metadata != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: Row(
              children: [
                if (_metadata!['thumbnail'] != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      _metadata!['thumbnail'].toString(),
                      width: 72,
                      height: 52,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) => Container(
                        width: 72,
                        height: 52,
                        color: AppTheme.surfaceElevated,
                        child: const Icon(Icons.movie_rounded, color: Colors.white54),
                      ),
                    ),
                  )
                else
                  Container(
                    width: 72,
                    height: 52,
                    decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(8)),
                    child: const Icon(Icons.video_collection_rounded, color: Colors.white54),
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _metadata!['title']?.toString() ?? 'Remote Video',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(Icons.timer_outlined, size: 13, color: AppTheme.textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            '${(_metadata!['durationSeconds'] as num?)?.toInt() ?? 0}s duration',
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                          const SizedBox(width: 10),
                          Icon(Icons.shield_outlined, size: 13, color: AppTheme.success),
                          const SizedBox(width: 4),
                          Text('100% Local Whisper', style: TextStyle(fontSize: 11, color: AppTheme.success)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],

        if (_error != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.error.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(_error!, style: TextStyle(color: AppTheme.error, fontSize: 12)),
          ),
        ],

        const SizedBox(height: 18),
        const Text('CUSTOMIZATION CONTROLS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white54, letterSpacing: 0.8)),
        const SizedBox(height: 12),

        // 1. Clip Count
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Number of Shorts:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            Row(
              children: [1, 2, 3, 5].map((cnt) {
                final isSel = _clipCount == cnt;
                return Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: ChoiceChip(
                    label: Text('$cnt ${cnt == 1 ? "Clip" : "Clips"}'),
                    selected: isSel,
                    onSelected: (_) => setState(() => _clipCount = cnt),
                    selectedColor: AppTheme.primary,
                    labelStyle: TextStyle(
                      fontSize: 11,
                      fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
                      color: isSel ? Colors.white : AppTheme.textSecondary,
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // 2. Target Duration
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Clip Duration:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            Row(
              children: [
                _durationChip(30, '< 30s Hook'),
                const SizedBox(width: 6),
                _durationChip(45, '45s Standard'),
                const SizedBox(width: 6),
                _durationChip(60, '60s Deep Dive'),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),

        // 3. Aspect Ratio / Framing
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Format / Aspect:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            Row(
              children: [
                _aspectChip('9:16', '9:16 Vertical', Icons.phone_android_rounded),
                const SizedBox(width: 6),
                _aspectChip('1:1', '1:1 Square', Icons.crop_square_rounded),
                const SizedBox(width: 6),
                _aspectChip('16:9', '16:9 Wide', Icons.tv_rounded),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),

        // 4. Kinetic Subtitles Theme
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Subtitles Style:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            DropdownButton<String>(
              value: _subtitleStyle,
              dropdownColor: AppTheme.surfaceElevated,
              underline: const SizedBox.shrink(),
              style: const TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w600),
              items: const [
                DropdownMenuItem(value: 'hormozi-yellow', child: Text('🔥 Hormozi Bold Yellow')),
                DropdownMenuItem(value: 'vox-clean', child: Text('📰 Vox Clean Modern')),
                DropdownMenuItem(value: 'minimal', child: Text('✨ Minimalist Glass')),
                DropdownMenuItem(value: 'none', child: Text('🚫 No Subtitles')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _subtitleStyle = v);
              },
            ),
          ],
        ),

        // 5. Background Music Selector
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Background Music:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            DropdownButton<String>(
              value: _musicMood,
              dropdownColor: AppTheme.surfaceElevated,
              underline: const SizedBox.shrink(),
              style: const TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w600),
              items: const [
                DropdownMenuItem(value: 'upbeat', child: Text('🎵 Upbeat Energy')),
                DropdownMenuItem(value: 'lo-fi', child: Text('☕ Lofi Chill')),
                DropdownMenuItem(value: 'cinematic', child: Text('🎬 Cinematic Drama')),
                DropdownMenuItem(value: 'ambient', child: Text('🌿 Ambient Soft')),
                DropdownMenuItem(value: 'none', child: Text('🚫 No Music')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _musicMood = v);
              },
            ),
          ],
        ),
        const SizedBox(height: 8),

        // 6. Motion Graphics Toggle
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('AI Director Motion Cards (HyperFrames)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          subtitle: Text('Auto-inject animated metric cards & concept highlights', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          value: _includeMotionGraphics,
          activeTrackColor: AppTheme.accent,
          onChanged: (v) => setState(() => _includeMotionGraphics = v),
        ),
        const SizedBox(height: 20),

        // Primary Action Button
        ElevatedButton.icon(
          onPressed: _urlController.text.trim().isEmpty ? null : _runAutoClipper,
          icon: const Icon(Icons.bolt_rounded),
          label: Text('Generate $_clipCount Viral Shorts'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ],
    );
  }

  Widget _buildProcessingView() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 8),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [AppTheme.primary, AppTheme.accent],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: const Center(
              child: SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3),
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Auto Clipper AI in Progress',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(
            'Harvesting, transcribing, and compiling viral shorts...',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 28),

          // Progress Steps
          Column(
            children: List.generate(_processingSteps.length, (idx) {
              final isDone = idx < _currentStepIndex;
              final isCurrent = idx == _currentStepIndex;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Icon(
                      isDone
                          ? Icons.check_circle_rounded
                          : isCurrent
                              ? Icons.radio_button_checked_rounded
                              : Icons.radio_button_unchecked_rounded,
                      color: isDone
                          ? AppTheme.success
                          : isCurrent
                              ? AppTheme.accent
                              : Colors.white30,
                      size: 20,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _processingSteps[idx],
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                          color: isCurrent
                              ? Colors.white
                              : isDone
                                  ? Colors.white70
                                  : Colors.white38,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildResultsView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '${_generatedShorts.length} Viral Shorts Ready',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            TextButton.icon(
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('New Video'),
              onPressed: () => setState(() {
                _generatedShorts = [];
                _urlController.clear();
                _metadata = null;
              }),
            ),
          ],
        ),
        const SizedBox(height: 12),

        for (int i = 0; i < _generatedShorts.length; i++) ...[
          _buildShortCard(_generatedShorts[i], i + 1),
          const SizedBox(height: 14),
        ],
      ],
    );
  }

  Widget _buildShortCard(Map<String, dynamic> short, int index) {
    final title = short['title']?.toString() ?? 'Short #$index';
    final hook = short['hookText']?.toString() ?? '';
    final dur = (short['durationSec'] as num?)?.toInt() ?? _targetDurationSec;
    final start = (short['startSec'] as num?)?.toDouble() ?? 0.0;
    final end = (short['endSec'] as num?)?.toDouble() ?? 0.0;
    final score = (short['viralityScore'] as num?)?.toInt() ?? 92;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppTheme.warning.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.local_fire_department_rounded, color: AppTheme.warning, size: 14),
                    const SizedBox(width: 4),
                    Text(
                      '$score% Viral Score',
                      style: TextStyle(color: AppTheme.warning, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
              Text(
                '${start.toStringAsFixed(1)}s - ${end.toStringAsFixed(1)}s • ${dur}s',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 10),

          Text(
            title,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
          ),
          const SizedBox(height: 4),
          Text(
            '"$hook"',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontStyle: FontStyle.italic),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (short['musicTrackTitle'] != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(Icons.music_note_rounded, size: 12, color: AppTheme.accent),
                const SizedBox(width: 4),
                Text(
                  '${short['musicTrackTitle']} (Sidechain Ducked)',
                  style: TextStyle(fontSize: 10.5, color: AppTheme.accent, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ],
          const SizedBox(height: 14),

          // Two Primary Action Buttons
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.send_rounded, size: 16),
                  label: const Text('Post to Platforms'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: () => _postDirectlyToPlatforms(short),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.movie_edit, size: 16),
                label: const Text('Studio'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onPressed: () => _openInVideoStudio(short),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _platformPill(String name, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(name, style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }

  Widget _durationChip(int sec, String label) {
    final isSel = _targetDurationSec == sec;
    return ChoiceChip(
      label: Text(label),
      selected: isSel,
      onSelected: (_) => setState(() => _targetDurationSec = sec),
      selectedColor: AppTheme.primary,
      labelStyle: TextStyle(
        fontSize: 11,
        fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
        color: isSel ? Colors.white : AppTheme.textSecondary,
      ),
    );
  }

  Widget _aspectChip(String val, String label, IconData icon) {
    final isSel = _aspectRatio == val;
    return ChoiceChip(
      avatar: Icon(icon, size: 13, color: isSel ? Colors.white : AppTheme.textSecondary),
      label: Text(label),
      selected: isSel,
      onSelected: (_) => setState(() => _aspectRatio = val),
      selectedColor: AppTheme.primary,
      labelStyle: TextStyle(
        fontSize: 11,
        fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
        color: isSel ? Colors.white : AppTheme.textSecondary,
      ),
    );
  }
}
