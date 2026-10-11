import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

enum SkeletonType {
  kanban,
  table,
  financial,
  projects,
  metrics,
  chat,
  calendar,
  form,
  editor,
  detail,
  activity,
}

/// Centralized, adaptive skeleton system adhering to .agents/rules/ui-architecture.md
/// Automatically adapts to dark mode and matches exact component geometry without CLS (layout shifts).
class UniversalSkeleton extends StatefulWidget {
  final SkeletonType type;
  final int itemCount;
  final double? height;

  const UniversalSkeleton({
    super.key,
    required this.type,
    this.itemCount = 3,
    this.height,
  });

  @override
  State<UniversalSkeleton> createState() => _UniversalSkeletonState();
}

class _UniversalSkeletonState extends State<UniversalSkeleton>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.35, end: 0.85).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  Widget _buildShimmerBox({
    double? width,
    double? height,
    BorderRadius? borderRadius,
  }) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        return Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            color: AppTheme.surfaceElevated.withValues(alpha: _pulseAnimation.value),
            borderRadius: borderRadius ?? BorderRadius.circular(8),
            border: Border.all(
              color: AppTheme.border.withValues(alpha: _pulseAnimation.value * 0.5),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    switch (widget.type) {
      case SkeletonType.calendar:
        return _buildCalendarSkeleton();
      case SkeletonType.editor:
        return _buildEditorSkeleton();
      case SkeletonType.chat:
        return _buildChatSkeleton();
      case SkeletonType.projects:
        return _buildProjectsSkeleton();
      case SkeletonType.metrics:
        return _buildMetricsSkeleton();
      case SkeletonType.table:
      case SkeletonType.activity:
        return _buildListSkeleton();
      case SkeletonType.kanban:
        return _buildKanbanSkeleton();
      case SkeletonType.financial:
      case SkeletonType.form:
      case SkeletonType.detail:
        return _buildDetailSkeleton();
    }
  }

  Widget _buildCalendarSkeleton() {
    return Column(
      children: List.generate(
        widget.itemCount,
        (index) => Container(
          margin: EdgeInsets.only(bottom: 12),
          padding: EdgeInsets.all(16),
          decoration: AppTheme.glassCardDecoration(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildShimmerBox(width: 80, height: 24, borderRadius: BorderRadius.circular(6)),
                  _buildShimmerBox(width: 70, height: 24, borderRadius: BorderRadius.circular(12)),
                ],
              ),
              SizedBox(height: 12),
              _buildShimmerBox(width: double.infinity, height: 16),
              SizedBox(height: 8),
              _buildShimmerBox(width: 200, height: 14),
              SizedBox(height: 16),
              Row(
                children: [
                  _buildShimmerBox(width: 90, height: 36, borderRadius: BorderRadius.circular(8)),
                  SizedBox(width: 8),
                  _buildShimmerBox(width: 90, height: 36, borderRadius: BorderRadius.circular(8)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEditorSkeleton() {
    return Column(
      children: [
        _buildShimmerBox(width: double.infinity, height: 220, borderRadius: BorderRadius.circular(12)),
        SizedBox(height: 16),
        _buildShimmerBox(width: double.infinity, height: 48, borderRadius: BorderRadius.circular(8)),
        SizedBox(height: 12),
        _buildShimmerBox(width: double.infinity, height: 56, borderRadius: BorderRadius.circular(8)),
        SizedBox(height: 12),
        _buildShimmerBox(width: double.infinity, height: 56, borderRadius: BorderRadius.circular(8)),
      ],
    );
  }

  Widget _buildChatSkeleton() {
    return Column(
      children: List.generate(
        widget.itemCount,
        (index) => Align(
          alignment: index.isEven ? Alignment.centerLeft : Alignment.centerRight,
          child: Container(
            margin: EdgeInsets.symmetric(vertical: 6),
            padding: EdgeInsets.all(14),
            width: 260,
            decoration: AppTheme.glassCardDecoration(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildShimmerBox(width: 140, height: 14),
                SizedBox(height: 8),
                _buildShimmerBox(width: 220, height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProjectsSkeleton() {
    return Column(
      children: List.generate(
        widget.itemCount,
        (index) => Container(
          margin: EdgeInsets.only(bottom: 12),
          padding: EdgeInsets.all(16),
          decoration: AppTheme.glassCardDecoration(),
          child: Row(
            children: [
              _buildShimmerBox(width: 44, height: 44, borderRadius: BorderRadius.circular(10)),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildShimmerBox(width: 120, height: 16),
                    SizedBox(height: 6),
                    _buildShimmerBox(width: 180, height: 12),
                  ],
                ),
              ),
              _buildShimmerBox(width: 24, height: 24, borderRadius: BorderRadius.circular(12)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricsSkeleton() {
    return GridView.count(
      shrinkWrap: true,
      physics: NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: List.generate(
        4,
        (index) => Container(
          padding: EdgeInsets.all(14),
          decoration: AppTheme.glassCardDecoration(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _buildShimmerBox(width: 70, height: 14),
              SizedBox(height: 8),
              _buildShimmerBox(width: 50, height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildListSkeleton() {
    return Column(
      children: List.generate(
        widget.itemCount,
        (index) => Container(
          margin: EdgeInsets.only(bottom: 10),
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: AppTheme.glassCardDecoration(),
          child: Row(
            children: [
              _buildShimmerBox(width: 36, height: 36, borderRadius: BorderRadius.circular(8)),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildShimmerBox(width: 160, height: 14),
                    SizedBox(height: 6),
                    _buildShimmerBox(width: 100, height: 12),
                  ],
                ),
              ),
              _buildShimmerBox(width: 44, height: 24, borderRadius: BorderRadius.circular(6)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKanbanSkeleton() {
    return Row(
      children: List.generate(
        2,
        (index) => Expanded(
          child: Container(
            margin: EdgeInsets.only(right: index == 0 ? 12 : 0),
            padding: EdgeInsets.all(12),
            decoration: AppTheme.glassCardDecoration(),
            child: Column(
              children: [
                _buildShimmerBox(width: 90, height: 18),
                SizedBox(height: 12),
                _buildShimmerBox(width: double.infinity, height: 60),
                SizedBox(height: 8),
                _buildShimmerBox(width: double.infinity, height: 60),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDetailSkeleton() {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: AppTheme.glassCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildShimmerBox(width: 140, height: 20),
          SizedBox(height: 16),
          _buildShimmerBox(width: double.infinity, height: 16),
          SizedBox(height: 8),
          _buildShimmerBox(width: double.infinity, height: 16),
          SizedBox(height: 8),
          _buildShimmerBox(width: 220, height: 16),
        ],
      ),
    );
  }
}
