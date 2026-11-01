import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/vault_item.dart';
import 'vault_provider.dart';

void showUrlMediaImportSheet(BuildContext context, WidgetRef ref, {String? targetFolderId}) {
  showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: UrlMediaImportSheet(targetFolderId: targetFolderId),
    ),
  );
}

class UrlMediaImportSheet extends ConsumerStatefulWidget {
  const UrlMediaImportSheet({super.key, this.targetFolderId});
  final String? targetFolderId;

  @override
  ConsumerState<UrlMediaImportSheet> createState() => _UrlMediaImportSheetState();
}

class _UrlMediaImportSheetState extends ConsumerState<UrlMediaImportSheet> {
  final _urlController = TextEditingController();
  bool _fetchingMeta = false;
  bool _downloading = false;
  bool _autoClipping = false;
  String? _error;
  Map<String, dynamic>? _metadata;
  bool _extractAudioOnly = false;

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
          _error = res['message']?.toString() ?? 'Failed to fetch video details';
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

  Future<void> _startDownload() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;

    setState(() {
      _downloading = true;
      _error = null;
    });

    try {
      final client = ref.read(apiClientProvider);
      final res = await client.post(
        '/api/v1/media-editor/ingest/download',
        body: {
          'url': url,
          'extractAudio': _extractAudioOnly,
        },
      );

      if (res['success'] == true) {
        final title = _metadata?['title']?.toString() ?? res['metadata']?['title']?.toString() ?? 'Imported Media';
        final localPath = res['localPath'] as String?;
        final isAudio = _extractAudioOnly || res['type'] == 'audio';
        final durSec = (_metadata?['durationSeconds'] as num?)?.toInt() ?? 0;

        await ref.read(vaultItemsProvider.notifier).addItem(
          name: title,
          type: isAudio ? VaultItemType.document : VaultItemType.video,
          folderId: widget.targetFolderId,
          localPath: localPath,
          durationMs: durSec * 1000,
          tags: isAudio ? ['audio', 'voiceover', 'yt-dlp'] : ['video', 'yt-dlp'],
        );

        if (mounted) {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Successfully imported "$title" to Library!')),
          );
        }
      } else {
        setState(() {
          _error = res['message']?.toString() ?? 'Download failed';
          _downloading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _downloading = false;
      });
    }
  }

  Future<void> _startAutoClip() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;

    setState(() {
      _autoClipping = true;
      _error = null;
    });

    try {
      final client = ref.read(apiClientProvider);
      final res = await client.post(
        '/api/v1/media-editor/ingest/auto-clip',
        body: {
          'url': url,
          'maxShorts': 3,
          'targetShortDurationSec': 35,
          'sync': true,
        },
      );

      if (res['success'] == true && res['result'] != null) {
        final result = res['result'] as Map<String, dynamic>;
        final shorts = (result['shorts'] as List?)?.whereType<Map<String, dynamic>>().toList() ?? [];

        for (final s in shorts) {
          final title = s['title']?.toString() ?? 'Viral Short';
          final localPath = s['videoPath']?.toString();
          final durSec = (s['durationSec'] as num?)?.toInt() ?? 30;

          await ref.read(vaultItemsProvider.notifier).addItem(
            name: title,
            type: VaultItemType.video,
            folderId: widget.targetFolderId,
            localPath: localPath,
            durationMs: durSec * 1000,
            tags: ['short', 'ai-director', '9:16', 'viral'],
          );
        }

        if (mounted) {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('AI Director created ${shorts.length} viral 9:16 shorts in Vault!')),
          );
        }
      } else {
        setState(() {
          _error = res['message']?.toString() ?? 'Auto-clip analysis failed';
          _autoClipping = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _autoClipping = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.link_rounded, color: AppTheme.accent, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Import Media from Link',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      Text(
                        'YouTube, Instagram, TikTok, Facebook, LinkedIn',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _urlController,
              decoration: InputDecoration(
                hintText: 'Paste video link here...',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.paste_rounded),
                  tooltip: 'Paste from clipboard',
                  onPressed: _pasteClipboard,
                ),
                filled: true,
                fillColor: AppTheme.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: AppTheme.border),
                ),
              ),
              onSubmitted: (_) => _fetchMetadata(),
            ),
            if (_fetchingMeta) ...[
              const SizedBox(height: 16),
              const Center(child: CircularProgressIndicator()),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.error.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.error.withValues(alpha: 0.3)),
                ),
                child: Text(
                  _error!,
                  style: TextStyle(color: AppTheme.error, fontSize: 13),
                ),
              ),
            ],
            if (_metadata != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Row(
                  children: [
                    if (_metadata!['thumbnail'] != null && (_metadata!['thumbnail'] as String).isNotEmpty)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          _metadata!['thumbnail'],
                          width: 80,
                          height: 54,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            width: 80,
                            height: 54,
                            color: AppTheme.surfaceElevated,
                            child: const Icon(Icons.movie_rounded),
                          ),
                        ),
                      ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _metadata!['title'] ?? 'Video',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${_metadata!['uploader'] ?? ''} · ${_formatDuration(_metadata!['durationSeconds'])}',
                            style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _extractAudioOnly,
                title: const Text('Extract audio only (16kHz WAV for Voiceover / Transcribe)', style: TextStyle(fontSize: 13)),
                onChanged: (val) => setState(() => _extractAudioOnly = val ?? false),
              ),
            ],
            const SizedBox(height: 20),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: _downloading || _autoClipping || (_metadata == null && !_fetchingMeta)
                  ? (_metadata == null ? _fetchMetadata : null)
                  : _startDownload,
              child: _downloading
                  ? const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
                        SizedBox(width: 12),
                        Text('Downloading Media...'),
                      ],
                    )
                  : Text(_metadata == null ? 'Inspect Video' : 'Import to Vault'),
            ),
            if (_metadata != null) ...[
              const SizedBox(height: 10),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF7C3AED),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _downloading || _autoClipping ? null : _startAutoClip,
                icon: _autoClipping
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.auto_awesome_rounded, size: 18),
                label: Text(_autoClipping ? 'Analyzing & Auto-Clipping Shorts...' : 'Auto-Clip into 9:16 Shorts (AI Director)'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDuration(dynamic sec) {
    final s = (sec is num ? sec : int.tryParse(sec.toString()) ?? 0).toInt();
    final m = s ~/ 60;
    final r = s % 60;
    return '$m:${r.toString().padLeft(2, '0')}';
  }
}
