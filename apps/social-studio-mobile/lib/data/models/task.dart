import '../../core/util/json.dart';

class WorkspaceUser {
  WorkspaceUser({required this.id, required this.name, this.email, this.imageUrl, this.role});
  final String id;
  final String name;
  final String? email;
  final String? imageUrl;
  final String? role;

  factory WorkspaceUser.fromJson(Json j) => WorkspaceUser(
        id: jStr(j['id']) ?? jStrOr(j['_id'], ''),
        name: jStr(j['name']) ??
            [jStr(j['firstName']), jStr(j['lastName'])].whereType<String>().join(' ').trim().ifEmpty(jStr(j['email']) ?? 'User'),
        email: jStr(j['email']),
        imageUrl: jStr(j['image']) ?? jStr(j['photoUrl']) ?? jStr(j['avatar']),
        role: jStr(j['role']),
      );
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// A task from the projects-and-tasks domain (editing tasks are regular tasks linked to a post).
class EditingTask {
  EditingTask({
    required this.id,
    required this.title,
    this.description,
    this.status,
    this.priority,
    this.dueDate,
    this.assignee,
    this.postId,
    this.deliverableUrl,
  });

  final String id;
  final String title;
  final String? description;
  final String? status;
  final String? priority;
  final DateTime? dueDate;
  final WorkspaceUser? assignee;
  final String? postId;
  final String? deliverableUrl;

  bool get isOverdue =>
      dueDate != null && dueDate!.isBefore(DateTime.now()) && status != 'done' && status != 'completed';

  factory EditingTask.fromJson(Json j) {
    final a = jMapOrNull(j['assignee']);
    final meta = jMap(j['metadata']);
    return EditingTask(
      id: jStrOr(j['id'], ''),
      title: jStr(j['title']) ?? jStr(j['name']) ?? 'Task',
      description: jStr(j['description']),
      status: jStr(j['status']),
      priority: jStr(j['priority']),
      dueDate: jDate(j['dueDate'] ?? j['deadline']),
      assignee: a == null ? null : WorkspaceUser.fromJson(a),
      postId: jStr(j['socialPostId']) ?? jStr(j['postId']) ?? jStr(meta['postId']),
      deliverableUrl: jStr(j['deliverableUrl']) ?? jStr(meta['deliverableUrl']),
    );
  }
}
