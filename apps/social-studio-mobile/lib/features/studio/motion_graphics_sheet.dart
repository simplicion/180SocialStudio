import 'package:flutter/material.dart';
import 'studio_controller.dart';
import 'studio_tools.dart';
import 'timeline_ops.dart';

class MotionGraphicsSheet extends StatefulWidget {
  const MotionGraphicsSheet({super.key, required this.c, required this.onEdit});

  final StudioController c;
  final EditFn onEdit;

  @override
  State<MotionGraphicsSheet> createState() => _MotionGraphicsSheetState();
}

class _MotionGraphicsSheetState extends State<MotionGraphicsSheet> {
  String _selectedTemplate = 'vox-explainer';
  final _titleController = TextEditingController(text: '3-Second Retention Rule');
  final _subtitleController = TextEditingController(text: 'Why the hook determines algorithm velocity');
  final _metricValueController = TextEditingController(text: '\$100K+');
  final _metricLabelController = TextEditingController(text: 'Monthly Revenue Peak');
  final _tagController = TextEditingController(text: 'KEY INSIGHT');

  final List<Map<String, dynamic>> _templates = [
    {
      'id': 'vox-explainer',
      'name': 'Vox Explainer',
      'icon': Icons.view_headline_rounded,
      'desc': 'High-contrast lower-third with kinetic typography and source tags.',
      'color': const Color(0xFF3B82F6),
    },
    {
      'id': 'hormozi-counter',
      'name': 'Hormozi Counter',
      'icon': Icons.bolt_rounded,
      'desc': 'Explosive, oversized numerical counter (\$ / % / x) for viral shorts.',
      'color': const Color(0xFFFACC15),
    },
    {
      'id': 'saas-callout',
      'name': 'SaaS Callout',
      'icon': Icons.layers_outlined,
      'desc': 'Glassmorphic dark pill with feature badge and micro-subtitle.',
      'color': const Color(0xFF10B981),
    },
    {
      'id': 'quote-reveal',
      'name': 'Quote Reveal',
      'icon': Icons.format_quote_rounded,
      'desc': 'Sophisticated editorial card with quotation mark and attribution.',
      'color': const Color(0xFFA855F7),
    },
    {
      'id': 'split-comparison',
      'name': 'Split Compare',
      'icon': Icons.compare_arrows_rounded,
      'desc': 'Side-by-side "The Old Way vs. 180 Studio Way" comparison.',
      'color': const Color(0xFFEF4444),
    },
  ];

  @override
  void dispose() {
    _titleController.dispose();
    _subtitleController.dispose();
    _metricValueController.dispose();
    _metricLabelController.dispose();
    _tagController.dispose();
    super.dispose();
  }

  void _applyCard() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    final playheadMs = widget.c.playheadMs;
    final cardText = _selectedTemplate == 'hormozi-counter'
        ? '${_metricValueController.text.trim()}\n$title'
        : '[${_tagController.text.trim()}] $title\n${_subtitleController.text.trim()}';

    widget.onEdit((ir) {
      return TimelineOps.addText(
        ir,
        cardText,
        startMs: playheadMs,
        durationMs: 3500,
        positionY: 0.72,
        positionX: 0.5,
      );
    }, done: 'Added ${_selectedTemplate.replaceAll('-', ' ')} card');

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF0F172A),
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(Icons.auto_awesome_motion_rounded, color: Color(0xFF38BDF8), size: 24),
                const SizedBox(width: 10),
                const Text(
                  'HyperFrames Motion Graphics',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close_rounded, color: Colors.grey),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'High-production kinetic cards. Choose a template or customize below:',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade400),
            ),
            const SizedBox(height: 16),
            // Template selector chips
            SizedBox(
              height: 96,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _templates.length,
                separatorBuilder: (context, index) => const SizedBox(width: 10),
                itemBuilder: (context, idx) {
                  final t = _templates[idx];
                  final isSelected = t['id'] == _selectedTemplate;
                  final color = t['color'] as Color;

                  return InkWell(
                    onTap: () {
                      setState(() {
                        _selectedTemplate = t['id'] as String;
                      });
                    },
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      width: 130,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: isSelected ? color.withValues(alpha: 0.18) : const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isSelected ? color : Colors.white12,
                          width: isSelected ? 2 : 1,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(t['icon'] as IconData, size: 22, color: color),
                          const Spacer(),
                          Text(
                            t['name'] as String,
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            t['id'] == 'hormozi-counter' ? 'Big Metric' : 'Kinetic Card',
                            style: TextStyle(fontSize: 10, color: Colors.grey.shade400),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 18),
            // Input fields
            if (_selectedTemplate == 'hormozi-counter') ...[
              TextField(
                controller: _metricValueController,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                decoration: InputDecoration(
                  labelText: 'Metric Number / Spoken Value',
                  labelStyle: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                  filled: true,
                  fillColor: const Color(0xFF1E293B),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 10),
            ],
            TextField(
              controller: _titleController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Headline / Statement',
                labelStyle: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _subtitleController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Subtitle / Context Detail',
                labelStyle: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _tagController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                labelText: 'Pill Tag (e.g. KEY INSIGHT, STEP 1)',
                labelStyle: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                onPressed: _applyCard,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Insert Motion Graphic at Playhead', style: TextStyle(fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
