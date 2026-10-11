export class AutomationService {
  static async trigger(params: any, companyPrisma: any = null) {
    return { 
      log: { id: 'auto_' + Date.now(), status: 'success' }, 
      notificationResult: { success: true } 
    };
  }

  static async processTrigger(params: any, companyPrisma: any) {
    return { success: true };
  }

  static moderateContent(text: string): string {
    return text;
  }
}

export default AutomationService;
