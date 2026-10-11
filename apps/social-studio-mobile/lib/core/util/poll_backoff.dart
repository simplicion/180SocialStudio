/// Delay before the next status poll of a long server job: quick at first, then slower so a 3-minute generation does
/// not cost ~90 requests. Tests pass a fixed [override].
Duration pollDelay(int pollsSoFar, {Duration? override}) {
  if (override != null) return override;
  if (pollsSoFar < 10) return const Duration(seconds: 2);
  if (pollsSoFar < 30) return const Duration(seconds: 5);
  return const Duration(seconds: 10);
}
