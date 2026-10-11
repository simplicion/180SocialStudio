import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models/social_post.dart';
import '../../data/models/task.dart';

class PostQuery {
  PostQuery({required this.projectId, this.status, this.isEvergreen, this.from, this.to});
  final String projectId;
  final String? status;
  final bool? isEvergreen;
  final DateTime? from;
  final DateTime? to;

  @override
  bool operator ==(Object other) =>
      other is PostQuery &&
      other.projectId == projectId &&
      other.status == status &&
      other.isEvergreen == isEvergreen &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(projectId, status, isEvergreen, from, to);
}

final projectPostsProvider = FutureProvider.autoDispose.family<List<SocialPost>, PostQuery>((ref, q) {
  return ref.watch(socialApiProvider).listPosts(
        projectId: q.projectId,
        status: q.status,
        isEvergreen: q.isEvergreen,
        from: q.from,
        to: q.to,
      );
});

final postDetailProvider = FutureProvider.autoDispose.family<SocialPost, String>((ref, id) {
  return ref.watch(socialApiProvider).getPost(id);
});

final projectTasksProvider = FutureProvider.autoDispose.family<List<EditingTask>, String>((ref, projectId) {
  return ref.watch(socialApiProvider).listTasks(projectId);
});

final workspaceUsersProvider = FutureProvider.autoDispose<List<WorkspaceUser>>((ref) {
  return ref.watch(socialApiProvider).listUsers();
});

extension PostRefresh on WidgetRef {
  /// Reloads everything a post write can change.
  void refreshPost(String postId, {String? projectId}) {
    invalidate(postDetailProvider(postId));
    invalidate(projectPostsProvider);
    if (projectId != null) invalidate(projectTasksProvider(projectId));
  }
}
