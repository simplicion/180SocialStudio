import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/vault_item.dart';
import '../library/vault_provider.dart';
import 'studio_drafts_service.dart';

/// Teleprompter camera with live script scrolling, customizable speed/font size,
/// multi-clip recording, and direct "Add to Library Folder" flow.
class CameraScreen extends ConsumerStatefulWidget {
  const CameraScreen({
    super.key,
    this.hook,
    this.script,
    this.projectId,
    this.postId,
    this.pieceId,
    this.folderId,
    this.folderName,
    this.speed = 1.2,
    this.fontSize = 22.0,
  });

  final String? hook;
  final String? script;
  final String? projectId;
  final String? postId;
  final String? pieceId;
  final String? folderId;
  final String? folderName;
  final double speed;
  final double fontSize;

  @override
  ConsumerState<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends ConsumerState<CameraScreen> with WidgetsBindingObserver {
  CameraController? _cam;
  List<CameraDescription> _cameras = const [];
  int _index = 0;
  Object? _error;
  bool _recording = false;
  bool _busy = false;
  int _seconds = 0;
  Timer? _timer;
  Timer? _scrollTimer;

  // Prompter & script state
  late String? _hook = widget.hook;
  late String? _script = widget.script;
  late String? _folderId = widget.folderId;
  late String? _folderName = widget.folderName;
  late double _speed = widget.speed;
  late double _fontSize = widget.fontSize;
  bool _prompterPaused = false;
  bool _prompterVisible = true;

  final _scrollCtl = ScrollController();

  // Multi-clip session tracking
  final List<VaultItem> _savedClips = [];

  bool get _hasScript => (_hook?.trim().isNotEmpty ?? false) || (_script?.trim().isNotEmpty ?? false);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _scrollTimer?.cancel();
    _scrollCtl.dispose();
    _cam?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final cam = _cam;
    if (cam == null || !cam.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      if (_recording) _stop();
      cam.dispose();
      _cam = null;
    } else if (state == AppLifecycleState.resumed && _cameras.isNotEmpty) {
      _open(_cameras[_index]);
    }
  }

  Future<void> _init() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) throw 'No camera was found on this device.';
      final front = _cameras.indexWhere((c) => c.lensDirection == CameraLensDirection.front);
      _index = front >= 0 && _hasScript ? front : 0;
      await _open(_cameras[_index]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _open(CameraDescription d) async {
    await _cam?.dispose();
    final cam = CameraController(d, ResolutionPreset.veryHigh, enableAudio: true);
    try {
      await cam.initialize();
      if (!mounted) {
        await cam.dispose();
        return;
      }
      setState(() {
        _cam = cam;
        _error = null;
      });
    } on CameraException catch (e) {
      await cam.dispose();
      if (mounted) {
        setState(() => _error = e.code == 'CameraAccessDenied' || e.code == 'AudioAccessDenied'
            ? 'Camera or microphone access is off. Allow it in Settings to record.'
            : 'Could not open the camera: ${e.description ?? e.code}');
      }
    }
  }

  Future<void> _flip() async {
    if (_cameras.length < 2 || _recording) return;
    _index = (_index + 1) % _cameras.length;
    await _open(_cameras[_index]);
  }

  Future<void> _start() async {
    final cam = _cam;
    if (cam == null || _busy) return;
    setState(() => _busy = true);
    try {
      await cam.startVideoRecording();
      setState(() {
        _recording = true;
        _seconds = 0;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => _seconds++);
      });

      _startAutoScroll();
    } catch (e) {
      if (mounted) showError(context, 'Recording could not start: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startAutoScroll() {
    _scrollTimer?.cancel();
    if (_prompterPaused) return;

    _scrollTimer = Timer.periodic(const Duration(milliseconds: 30), (_) {
      if (_scrollCtl.hasClients &&
          !_prompterPaused &&
          _scrollCtl.offset < _scrollCtl.position.maxScrollExtent) {
        _scrollCtl.jumpTo(_scrollCtl.offset + _speed);
      }
    });
  }

  void _togglePrompterPause() {
    setState(() {
      _prompterPaused = !_prompterPaused;
    });
    if (!_prompterPaused && _recording) {
      _startAutoScroll();
    } else {
      _scrollTimer?.cancel();
    }
  }

  Future<void> _stop() async {
    final cam = _cam;
    if (cam == null || !_recording) return;
    _timer?.cancel();
    _scrollTimer?.cancel();
    final recordedSeconds = _seconds;

    setState(() {
      _recording = false;
      _busy = true;
    });

    try {
      final recorded = await cam.stopVideoRecording();
      // Move the take out of the purgeable camera cache before anything references its path.
      final file = XFile(await ref.read(clipStoreProvider).persist(recorded.path, projectId: widget.projectId));
      if (!mounted) return;

      // Prompt to save this clip directly into the folder!
      await _handleRecordedClip(file, recordedSeconds);
    } catch (e) {
      if (mounted) showError(context, 'The recording could not be saved: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Handles saving the clip into the project's Library folder and offering multi-clip options.
  Future<void> _handleRecordedClip(XFile file, int durationSeconds) async {
    int fileSize = 0;
    try {
      fileSize = await file.length();
    } catch (_) {}

    // Ensure we have a destination folder (named after the calendar piece when shooting for one)
    if (_folderId == null || _folderId!.isEmpty) {
      final folderName = (widget.folderName?.trim().isNotEmpty ?? false)
          ? widget.folderName!.trim()
          : 'Shoot · ${DateTime.now().month}/${DateTime.now().day}';
      try {
        final newFolder = await ref.read(vaultFoldersProvider.notifier).createFolder(name: folderName);
        _folderId = newFolder.id;
        _folderName = newFolder.name;
      } catch (_) {}
    }

    final pieceId = widget.pieceId;
    // For a calendar piece the takes are numbered across sessions (Clip 1…N); otherwise per shoot.
    final takeNumber = pieceId != null
        ? (ref.read(vaultItemsProvider).valueOrNull?.where((i) => i.pieceId == pieceId).length ?? _savedClips.length) + 1
        : _savedClips.length + 1;
    final defaultClipName = pieceId != null
        ? 'Clip $takeNumber'
        : '${_folderName ?? "Take"} · Take $takeNumber (${timecode(durationSeconds * 1000)})';

    VaultItem? saved;
    // Saves the take once. A failure is shown and keeps the sheet open, so a clip is never lost silently.
    Future<VaultItem?> saveTake() async {
      if (saved != null) return saved;
      try {
        final item = await ref.read(vaultItemsProvider.notifier).addItem(
              folderId: _folderId,
              name: defaultClipName,
              type: VaultItemType.video,
              localPath: file.path,
              fileSizeBytes: fileSize,
              durationMs: durationSeconds * 1000,
              tags: ['take-$takeNumber', 'teleprompter'],
              pieceId: pieceId,
              takeIndex: pieceId == null ? null : takeNumber,
            );
        saved = item;
        if (mounted) setState(() => _savedClips.add(item));
        return item;
      } catch (e) {
        if (mounted) showError(context, 'The clip could not be saved: ${errorText(e)}');
        return null;
      }
    }

    // Show modal action sheet to Add to Folder or Edit
    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        bool savingToFolder = false;
        bool added = false;

        return StatefulBuilder(
          builder: (modalCtx, setModalState) {
            return Container(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              decoration: BoxDecoration(
                color: AppTheme.surfaceElevated,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Grab handle
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Header with Take Info
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppTheme.success.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(Icons.check_circle_rounded, color: AppTheme.success, size: 24),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Take $takeNumber Recorded!',
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Duration: ${timecode(durationSeconds * 1000)} · Folder: ${_folderName ?? "Library"}',
                              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppTheme.surface,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Text(
                          '${_savedClips.length + (added ? 1 : 0)} clips in folder',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.accent),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Primary Button 1: Add Clip to Folder
                  if (!added)
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: savingToFolder
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Icon(Icons.create_new_folder_rounded, size: 20),
                      label: Text(
                        savingToFolder ? 'Adding to Folder...' : 'Add Clip to Folder (${_folderName ?? "Library"})',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      onPressed: savingToFolder
                          ? null
                          : () async {
                              setModalState(() => savingToFolder = true);
                              final item = await saveTake();
                              setModalState(() {
                                savingToFolder = false;
                                added = item != null;
                              });
                              if (item != null && mounted) {
                                showInfo(context, 'Clip added to ${_folderName ?? "folder"}!');
                              }
                            },
                    )
                  else
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.success.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.success.withValues(alpha: 0.3)),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.check_circle_rounded, color: AppTheme.success, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Clip safely added to "${_folderName ?? "Library"}"',
                              style: TextStyle(color: AppTheme.success, fontWeight: FontWeight.w600, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 12),

                  // Actions: Shoot Next Clip | Open in Video Editor | Finish
                  Row(
                    children: [
                      // Shoot Next Clip
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            side: BorderSide(color: AppTheme.primary),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          icon: const Icon(Icons.videocam_rounded, size: 18),
                          label: const Text('Shoot Next Clip', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          onPressed: () async {
                            // If user didn't explicitly tap Add to Folder, auto-add now
                            if (await saveTake() == null) return;
                            if (modalCtx.mounted) {
                              Navigator.of(modalCtx).pop();
                            }
                            // Reset prompter scroll and seconds
                            if (mounted) {
                              setState(() {
                                _seconds = 0;
                              });
                            }
                            if (_scrollCtl.hasClients) {
                              _scrollCtl.jumpTo(0);
                            }
                          },
                        ),
                      ),
                      const SizedBox(width: 10),

                      // Open in Studio Video Editor
                      Expanded(
                        child: FilledButton.tonalIcon(
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          icon: const Icon(Icons.movie_edit, size: 18),
                          label: const Text('Edit in Studio', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          onPressed: () async {
                            if (await saveTake() == null) return;

                            if (modalCtx.mounted) {
                              Navigator.of(modalCtx).pop();
                            }
                            final q = [
                              if (widget.postId?.isNotEmpty ?? false) 'postId=${widget.postId}',
                              if (widget.projectId?.isNotEmpty ?? false) 'projectId=${widget.projectId}',
                            ].join('&');

                            if (mounted) {
                              context.pushReplacement(
                                '/studio/session${q.isEmpty ? '' : '?$q'}',
                                extra: {
                                  'sourcePath': file.path,
                                  'pieceId': widget.pieceId,
                                  'hook': _hook,
                                  'script': _script,
                                  'folderId': _folderId,
                                  'folderName': _folderName,
                                },
                              );
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),

                  // Option to Finish & View Folder in Library
                  TextButton.icon(
                    icon: const Icon(Icons.folder_open_rounded, size: 16),
                    label: Text(pieceId != null
                        ? 'Done: back to this calendar day'
                        : 'Finish & View all clips in Library (${_folderName ?? "Folder"})'),
                    onPressed: () async {
                      if (await saveTake() == null) return;
                      if (modalCtx.mounted) {
                        Navigator.of(modalCtx).pop();
                      }
                      // Shooting for a calendar piece: go back to its sheet, which lists the clips.
                      if (pieceId != null) {
                        if (mounted) context.pop(true);
                        return;
                      }
                      if (_folderId != null) {
                        ref.read(activeFolderIdProvider.notifier).state = _folderId;
                      }
                      if (mounted) {
                        context.pushReplacement('/library');
                      }
                    },
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Live in-camera script editor modal
  void _openScriptEditor() {
    final hookCtl = TextEditingController(text: _hook ?? '');
    final scriptCtl = TextEditingController(text: _script ?? '');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surfaceElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.edit_note_rounded, color: AppTheme.accent),
                const SizedBox(width: 8),
                const Text('Teleprompter Script', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const Spacer(),
                TextButton.icon(
                  icon: const Icon(Icons.content_paste_rounded, size: 14),
                  label: const Text('Paste'),
                  onPressed: () async {
                    final d = await Clipboard.getData('text/plain');
                    if (d?.text != null) scriptCtl.text = d!.text!;
                  },
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: hookCtl,
              decoration: fieldDecoration('Hook (optional)'),
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: scriptCtl,
              maxLines: 6,
              decoration: fieldDecoration('Paste or edit script...'),
              style: const TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primary),
              onPressed: () {
                setState(() {
                  _hook = hookCtl.text.trim().isEmpty ? null : hookCtl.text.trim();
                  _script = scriptCtl.text.trim().isEmpty ? null : scriptCtl.text.trim();
                });
                Navigator.of(ctx).pop();
              },
              child: const Text('Update Prompter'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cam = _cam;
    final mono = GoogleFonts.jetBrainsMono(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white);

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // ── Camera Preview ──
          if (cam != null && cam.value.isInitialized)
            Center(child: CameraPreview(cam))
          else if (_error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: ErrorView(error: _error!, compact: true, onRetry: _init),
              ),
            )
          else
            Center(child: CircularProgressIndicator(color: AppTheme.primary)),

          // ── Camera Overlay UI ──
          SafeArea(
            child: Column(
              children: [
                // Top App Bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(
                    children: [
                      // Close button
                      IconButton(
                        tooltip: 'Exit Camera',
                        style: IconButton.styleFrom(backgroundColor: Colors.black54, minimumSize: const Size(42, 42)),
                        onPressed: _recording ? null : () => context.pop(),
                        icon: const Icon(Icons.close_rounded, color: Colors.white),
                      ),
                      const SizedBox(width: 8),

                      // Folder pill
                      if (_folderName != null && _folderName!.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.white24),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.folder_rounded, size: 14, color: Color(0xFF6366F1)),
                              const SizedBox(width: 6),
                              ConstrainedBox(
                                constraints: const BoxConstraints(maxWidth: 110),
                                child: Text(
                                  _folderName!,
                                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (_savedClips.isNotEmpty) ...[
                                const SizedBox(width: 4),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                  decoration: BoxDecoration(color: AppTheme.success, borderRadius: BorderRadius.circular(6)),
                                  child: Text(
                                    '${_savedClips.length}',
                                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),

                      const Spacer(),

                      // Timer pill
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(10)),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_recording)
                              Container(
                                width: 9,
                                height: 9,
                                margin: const EdgeInsets.only(right: 6),
                                decoration: BoxDecoration(color: AppTheme.error, shape: BoxShape.circle),
                              ),
                            Text(
                              '${(_seconds ~/ 60).toString().padLeft(2, '0')}:${(_seconds % 60).toString().padLeft(2, '0')}',
                              style: mono,
                            ),
                          ],
                        ),
                      ),

                      const Spacer(),

                      // Prompter Visibility Eye Toggle
                      if (_hasScript) ...[
                        IconButton(
                          tooltip: _prompterVisible ? 'Hide Prompter' : 'Show Prompter',
                          style: IconButton.styleFrom(backgroundColor: Colors.black54, minimumSize: const Size(42, 42)),
                          onPressed: () => setState(() => _prompterVisible = !_prompterVisible),
                          icon: Icon(_prompterVisible ? Icons.visibility_rounded : Icons.visibility_off_rounded, color: Colors.white),
                        ),
                        const SizedBox(width: 6),
                      ],

                      // Edit Script button
                      IconButton(
                        tooltip: 'Edit Script',
                        style: IconButton.styleFrom(backgroundColor: Colors.black54, minimumSize: const Size(42, 42)),
                        onPressed: _recording ? null : _openScriptEditor,
                        icon: const Icon(Icons.edit_note_rounded, color: Colors.white),
                      ),
                      const SizedBox(width: 6),

                      // Flip Camera
                      IconButton(
                        tooltip: 'Switch camera',
                        style: IconButton.styleFrom(backgroundColor: Colors.black54, minimumSize: const Size(42, 42)),
                        onPressed: _cameras.length > 1 && !_recording ? _flip : null,
                        icon: const Icon(Icons.flip_camera_ios_rounded, color: Colors.white),
                      ),
                    ],
                  ),
                ),

                // ── Prompter Script Overlay ──
                if (_hasScript && _prompterVisible)
                  Expanded(
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.52),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: Stack(
                        children: [
                          GestureDetector(
                            onTap: _togglePrompterPause,
                            child: ListView(
                              controller: _scrollCtl,
                              padding: const EdgeInsets.fromLTRB(16, 20, 16, 240),
                              children: [
                                if (_hook?.trim().isNotEmpty ?? false) ...[
                                  Text(
                                    'HOOK · EYE CONTACT AT LENS',
                                    style: TextStyle(
                                      color: AppTheme.accentBlue,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 11,
                                      letterSpacing: 1.2,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    _hook!,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: _fontSize + 4,
                                      fontWeight: FontWeight.w900,
                                      height: 1.25,
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  Divider(color: Colors.white24, height: 1),
                                  const SizedBox(height: 18),
                                ],
                                if (_script?.trim().isNotEmpty ?? false)
                                  Text(
                                    _script!,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: _fontSize,
                                      height: 1.5,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                              ],
                            ),
                          ),

                          // Floating prompter indicator (Pause/Resume badge)
                          Positioned(
                            top: 8,
                            right: 8,
                            child: InkWell(
                              onTap: _togglePrompterPause,
                              borderRadius: BorderRadius.circular(6),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _prompterPaused ? Colors.amber.withValues(alpha: 0.9) : Colors.black54,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      _prompterPaused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                                      size: 14,
                                      color: _prompterPaused ? Colors.black : Colors.white,
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      _prompterPaused ? 'PAUSED' : 'SCROLLING',
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: FontWeight.bold,
                                        color: _prompterPaused ? Colors.black : Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                else if (!_hasScript)
                  Expanded(
                    child: Center(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.black54,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                            side: const BorderSide(color: Colors.white24),
                          ),
                        ),
                        icon: const Icon(Icons.note_add_rounded, size: 18),
                        label: const Text('Paste Script for Teleprompter'),
                        onPressed: _openScriptEditor,
                      ),
                    ),
                  )
                else
                  const Spacer(),

                // ── Live Prompter Speed & Font Controls ──
                if (_hasScript)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.speed_rounded, color: Colors.white70, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            '${_speed.toStringAsFixed(1)}x',
                            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                          Expanded(
                            child: Slider(
                              value: _speed,
                              min: 0.4,
                              max: 3.0,
                              divisions: 26,
                              activeColor: AppTheme.primary,
                              inactiveColor: Colors.white24,
                              onChanged: (v) => setState(() => _speed = v),
                            ),
                          ),
                          // Font Size controls
                          InkWell(
                            onTap: () => setState(() => _fontSize = (_fontSize - 2).clamp(16.0, 32.0)),
                            child: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              child: Text('A-', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 12)),
                            ),
                          ),
                          InkWell(
                            onTap: () => setState(() => _fontSize = (_fontSize + 2).clamp(16.0, 32.0)),
                            child: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              child: Text('A+', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                // ── Shutter Button ──
                Padding(
                  padding: const EdgeInsets.only(bottom: 20, top: 6),
                  child: Semantics(
                    button: true,
                    label: _recording ? 'Stop recording' : 'Start recording',
                    child: GestureDetector(
                      onTap: cam == null || _busy ? null : (_recording ? _stop : _start),
                      child: Container(
                        width: 78,
                        height: 78,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 4),
                        ),
                        child: Center(
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            width: _recording ? 30 : 62,
                            height: _recording ? 30 : 62,
                            decoration: BoxDecoration(
                              color: AppTheme.error,
                              borderRadius: BorderRadius.circular(_recording ? 8 : 40),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
