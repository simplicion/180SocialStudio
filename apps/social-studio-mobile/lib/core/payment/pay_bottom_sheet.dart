import 'package:flutter/material.dart';
import 'one_eighty_pay.dart';

export 'one_eighty_pay.dart';

/// Legacy bridge for [PayBottomSheet].
///
/// New integrations should use [OneEightyPay.open] or [OneEightyPayButton].
class PayBottomSheet {
  PayBottomSheet._();

  static Uri resolveCheckoutUri(Uri original) => OneEightyPay.resolveCheckoutUri(original);

  /// Displays the in-app payment bottom sheet and returns `true` if payment was completed.
  static Future<bool> show(
    BuildContext context, {
    required Uri checkoutUrl,
    bool fullScreen = false,
    String? returnUrl,
  }) async {
    final result = await OneEightyPay.open(
      context,
      options: OneEightyPayOptions(
        checkoutUrl: checkoutUrl,
        fullScreen: fullScreen,
        returnUrl: returnUrl,
      ),
    );
    return result.isSuccess;
  }
}
