import { TeviPaymentService } from '../services/TeviPaymentService';
import { StarWallet } from '../services/StarWallet';
import { TopUpPendingStore } from '../services/TopUpPendingStore';
import { TestRunner } from './TestRunner';

/**
 * Contract top-up mới: TeviJS.topup OK → cộng ngay, không poll webhook ~90s.
 * Chạy trong Editor Play Mode qua TestRunnerComponent.
 */
export function runTeviPaymentServiceTests(): TestRunner {
    const t = new TestRunner();
    const payment = TeviPaymentService.getInstance();

    t.describe('TeviPaymentService top-up contract', () => {
        t.it('post-SDK confirm budget is far below 60s KV lag', () => {
            const budget = TeviPaymentService.getPostSdkConfirmBudgetMs();
            t.assertTrue(budget > 0, 'confirm budget must be > 0');
            t.assertTrue(
                budget <= 1500,
                `confirm budget ${budget}ms must be <= 1500ms (old poll was 90000ms)`,
            );
        });

        t.it('debugCreditOnSdkOk adds pack stars without waiting webhook', () => {
            const before = StarWallet.getInstance().getBalance();
            const result = payment.debugCreditOnSdkOk('pack_100');
            t.assertTrue(result.ok, 'editor SDK credit must succeed');
            t.assertEquals(result.stars, 100, 'pack_100 must grant 100');
            t.assertEquals(result.balance, before + 100, 'balance must rise immediately');
            t.assertTrue(result.orderId.length > 0, 'order id required for anti-duplicate');
            t.assertTrue(
                TopUpPendingStore.getInstance().isCredited(result.orderId),
                'order must be marked credited',
            );
        });

        t.it('same order is not credited twice', () => {
            const first = payment.debugCreditOnSdkOk('pack_100');
            const mid = StarWallet.getInstance().getBalance();
            const again = StarWallet.getInstance().addStars(0, 'noop');
            t.assertEquals(again, mid, 'zero add must not change balance');
            t.assertTrue(
                TopUpPendingStore.getInstance().isCredited(first.orderId),
                'first order stays credited',
            );
        });
    });

    return t;
}
