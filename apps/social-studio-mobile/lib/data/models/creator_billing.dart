import '../../core/util/json.dart';

/// Billing and entitlement status for 180 Social Studio Creator plan.
class CreatorBillingStatus {
  const CreatorBillingStatus({
    required this.canAccess,
    required this.isTrial,
    required this.trialDaysRemaining,
    this.trialEndDate,
    required this.hasActiveSubscription,
    required this.hasActivePass,
    required this.passDaysRemaining,
    this.subscriptionEndDate,
    this.planName,
    this.dailyRate = 0.71,
    this.monthlyRate = 20.00,
    this.lockReason,
    this.message,
  });

  final bool canAccess;
  final bool isTrial;
  final int trialDaysRemaining;
  final DateTime? trialEndDate;
  final bool hasActiveSubscription;
  final bool hasActivePass;
  final int passDaysRemaining;
  final DateTime? subscriptionEndDate;
  final String? planName;
  final double dailyRate;
  final double monthlyRate;
  final String? lockReason;
  final String? message;

  factory CreatorBillingStatus.fromJson(Json j) {
    return CreatorBillingStatus(
      canAccess: jBool(j['canAccess']),
      isTrial: jBool(j['isTrial']),
      trialDaysRemaining: jInt(j['trialDaysRemaining']) ?? 0,
      trialEndDate: jDate(j['trialEndDate']),
      hasActiveSubscription: jBool(j['hasActiveSubscription']),
      hasActivePass: jBool(j['hasActivePass']),
      passDaysRemaining: jInt(j['passDaysRemaining']) ?? 0,
      subscriptionEndDate: jDate(j['subscriptionEndDate']),
      planName: jStr(j['planName']),
      dailyRate: (j['dailyRate'] as num?)?.toDouble() ?? 0.71,
      monthlyRate: (j['monthlyRate'] as num?)?.toDouble() ?? 20.00,
      lockReason: jStr(j['lockReason']),
      message: jStr(j['message']),
    );
  }

  static const initial = CreatorBillingStatus(
    canAccess: true,
    isTrial: true,
    trialDaysRemaining: 3,
    hasActiveSubscription: false,
    hasActivePass: false,
    passDaysRemaining: 0,
    dailyRate: 0.71,
    monthlyRate: 20.00,
  );
}

/// Checkout session details returned by 180 Pay
class CreatorCheckoutResult {
  const CreatorCheckoutResult({
    required this.checkoutUrl,
    required this.amount,
    this.orderId,
    this.currency = 'USD',
    this.title = '',
    this.type = 'monthly',
    this.days = 30,
  });

  final String checkoutUrl;
  final double amount;
  final String? orderId;
  final String currency;
  final String title;
  final String type;
  final int days;

  factory CreatorCheckoutResult.fromJson(Json j) {
    return CreatorCheckoutResult(
      checkoutUrl: jStrOr(j['checkoutUrl'], ''),
      amount: (j['amount'] as num?)?.toDouble() ?? 20.00,
      orderId: jStr(j['orderId']),
      currency: jStrOr(j['currency'], 'USD'),
      title: jStrOr(j['title'], ''),
      type: jStrOr(j['type'], 'monthly'),
      days: jInt(j['days']) ?? 30,
    );
  }
}
