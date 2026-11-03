import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/platform.dart';
import '../command_center/create_tab.dart';
import '../projects/project_provider.dart';

/// "More ways to create" (was the Command Center's Create tab): draft a post from an idea, or repurpose long-form
/// text, written to one platform's rules.
class MoreCreateScreen extends ConsumerStatefulWidget {
  const MoreCreateScreen({super.key, required this.projectId});
  final String projectId;

  @override
  ConsumerState<MoreCreateScreen> createState() => _MoreCreateScreenState();
}

class _MoreCreateScreenState extends ConsumerState<MoreCreateScreen> {
  late String _platform = () {
    final accounts = ref.read(activeProjectProvider).valueOrNull?.socialAccounts ?? const [];
    return accounts.where((a) => a.isActive && SocialPlatform.connectable.contains(a.platform)).map((a) => a.platform.id).firstOrNull ?? 'instagram';
  }();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Draft or repurpose'),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(52),
            child: SizedBox(
              height: 52,
              child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), children: [
                for (final p in SocialPlatform.connectable)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      avatar: Icon(p.icon, size: 16, color: p.color),
                      label: Text(p.label),
                      selected: _platform == p.id,
                      onSelected: (_) => setState(() => _platform = p.id),
                    ),
                  ),
              ]),
            ),
          ),
        ),
        body: CreateTab(key: ValueKey('create-$_platform'), platform: _platform, projectId: widget.projectId),
      );
}
