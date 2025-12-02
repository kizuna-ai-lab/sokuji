import { useState, useEffect, useCallback, useRef } from 'react';
import { useAnalytics } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { Wallet as WalletIcon, Plus, History, CreditCard, AlertCircle, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import './Wallet.scss';

// Helper to safely parse JSON response
async function safeJsonParse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    console.error('Response is not JSON:', contentType);
    return null;
  }
  try {
    return await response.json();
  } catch {
    console.error('Failed to parse JSON response');
    return null;
  }
}

interface WalletStatus {
  balance: number;
  frozen: boolean;
  usage: number;
}

interface PaymentConfig {
  publishableKey: string;
  minAmount: number;
  maxAmount: number;
  tokensPerDollar: number;
}

interface PaymentHistoryItem {
  id: string;
  amount_tokens: number;
  description: string;
  metadata: string;
  created_at: number;
}

export function Wallet() {
  const { trackEvent } = useAnalytics();
  const { t, locale } = useI18n();

  // Ref to prevent duplicate fetches
  const fetchAttemptedRef = useRef(false);

  // State
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Top-up form state
  const [topUpAmount, setTopUpAmount] = useState<number>(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Preset amounts
  const presetAmounts = [5, 10, 20, 50, 100];

  // Format numbers for display
  const formatTokens = (tokens: number | undefined | null): string => {
    if (tokens == null || isNaN(tokens)) return '0';
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateStr: string): string => {
    const localeMap: Record<string, string> = {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
    };
    return new Date(dateStr).toLocaleDateString(localeMap[locale] || 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Fetch wallet status
  const fetchWalletStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/wallet/status', {
        credentials: 'include',
      });
      if (!response.ok) {
        // Don't throw for auth errors, just return
        if (response.status === 401) return;
        throw new Error('Failed to fetch wallet status');
      }
      const data = await safeJsonParse<WalletStatus>(response);
      if (data) setWalletStatus(data);
    } catch (err) {
      console.error('Error fetching wallet status:', err);
      // Only set error once, don't cause re-renders
      setError((prev) => prev || t('dashboard.wallet.errorFetchingBalance'));
    }
  }, [t]);

  // Fetch payment config
  const fetchPaymentConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/payment/config', {
        credentials: 'include',
      });
      if (!response.ok) {
        // Stripe not configured or error
        setPaymentConfig(null);
        return;
      }
      const data = await safeJsonParse<PaymentConfig>(response);
      setPaymentConfig(data);
    } catch (err) {
      console.error('Error fetching payment config:', err);
      setPaymentConfig(null);
    }
  }, []);

  // Fetch payment history
  const fetchPaymentHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch('/api/payment/history?limit=10', {
        credentials: 'include',
      });
      if (!response.ok) {
        // Don't throw for auth errors
        if (response.status === 401) return;
        throw new Error('Failed to fetch payment history');
      }
      const data = await safeJsonParse<{ payments: PaymentHistoryItem[] }>(response);
      setPaymentHistory(data?.payments || []);
    } catch (err) {
      console.error('Error fetching payment history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Check for payment success from URL (runs once on mount)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('success');

    if (paymentStatus === 'true') {
      setPaymentSuccess(true);
      trackEvent('payment_completed', { source: 'redirect' });
      // Clean URL
      window.history.replaceState({}, '', '/dashboard/wallet');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial data fetch (runs once on mount)
  useEffect(() => {
    // Prevent duplicate fetches (React StrictMode, etc.)
    if (fetchAttemptedRef.current) return;
    fetchAttemptedRef.current = true;

    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        fetchWalletStatus(),
        fetchPaymentConfig(),
        fetchPaymentHistory(),
      ]);
      setLoading(false);
    };
    loadData();
    trackEvent('wallet_page_viewed', { page: 'wallet' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle top-up submission
  const handleTopUp = async () => {
    if (!paymentConfig) return;

    const amountCents = Math.round(topUpAmount * 100);

    if (amountCents < paymentConfig.minAmount) {
      setError(t('dashboard.wallet.minAmountError').replace('{min}', formatCurrency(paymentConfig.minAmount / 100)));
      return;
    }

    if (amountCents > paymentConfig.maxAmount) {
      setError(t('dashboard.wallet.maxAmountError').replace('{max}', formatCurrency(paymentConfig.maxAmount / 100)));
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      trackEvent('payment_initiated', { amount: topUpAmount });

      const response = await fetch('/api/payment/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ amount: amountCents }),
      });

      const data = await safeJsonParse<{ url?: string; error?: string }>(response);

      if (!response.ok || !data) {
        throw new Error(data?.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Error creating checkout:', err);
      setError(err instanceof Error ? err.message : t('dashboard.wallet.paymentError'));
      trackEvent('payment_error', { error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Calculate tokens for amount
  const tokensForAmount = paymentConfig
    ? Math.floor(topUpAmount * paymentConfig.tokensPerDollar)
    : 0;

  if (loading) {
    return (
      <div className="wallet-page">
        <div className="loading-state">
          <Loader2 className="animate-spin" size={32} />
          <p>{t('dashboard.wallet.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-page">
      {/* Success Alert */}
      {paymentSuccess && (
        <Alert variant="success" className="wallet-page__alert">
          {t('dashboard.wallet.paymentSuccess')}
        </Alert>
      )}

      {/* Error Alert */}
      {error && (
        <Alert variant="error" className="wallet-page__alert">
          {error}
        </Alert>
      )}

      <div className="wallet-page__header">
        <h1>{t('dashboard.wallet.title')}</h1>
        <p>{t('dashboard.wallet.subtitle')}</p>
      </div>

      <div className="wallet-page__grid">
        {/* Balance Card */}
        <div className="wallet-card">
          <div className="wallet-card__header">
            <WalletIcon size={20} />
            <h2>{t('dashboard.wallet.balance')}</h2>
          </div>
          <div className="wallet-card__content">
            <div className="wallet-card__balance">
              <span className="wallet-card__balance-amount">
                {walletStatus ? formatTokens(walletStatus.balance) : '0'}
              </span>
              <span className="wallet-card__balance-label">{t('dashboard.wallet.tokens')}</span>
            </div>

            {walletStatus?.frozen && (
              <div className="wallet-card__frozen-warning">
                <AlertCircle size={16} />
                {t('dashboard.wallet.accountFrozen')}
              </div>
            )}

            <div className="wallet-card__stats">
              <div className="wallet-card__stat">
                <span className="wallet-card__stat-label">{t('dashboard.wallet.last30Days')}</span>
                <span className="wallet-card__stat-value">
                  {walletStatus ? formatTokens(walletStatus.usage) : '0'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Top-Up Card */}
        <div className="wallet-card">
          <div className="wallet-card__header">
            <Plus size={20} />
            <h2>{t('dashboard.wallet.topUp')}</h2>
          </div>
          <div className="wallet-card__content">
            {paymentConfig ? (
              <>
                <div className="wallet-card__preset-amounts">
                  {presetAmounts.map((amount) => (
                    <button
                      key={amount}
                      className={`wallet-card__preset-btn ${topUpAmount === amount ? 'wallet-card__preset-btn--active' : ''}`}
                      onClick={() => setTopUpAmount(amount)}
                      disabled={isProcessing}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>

                <div className="wallet-card__custom-amount">
                  <label htmlFor="custom-amount">{t('dashboard.wallet.customAmount')}</label>
                  <div className="wallet-card__amount-input">
                    <span className="wallet-card__currency">$</span>
                    <input
                      id="custom-amount"
                      type="number"
                      min={paymentConfig.minAmount / 100}
                      max={paymentConfig.maxAmount / 100}
                      step="1"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      disabled={isProcessing}
                    />
                  </div>
                  <span className="wallet-card__amount-range">
                    {t('dashboard.wallet.amountRange')
                      .replace('{min}', formatCurrency(paymentConfig.minAmount / 100))
                      .replace('{max}', formatCurrency(paymentConfig.maxAmount / 100))}
                  </span>
                </div>

                <div className="wallet-card__tokens-preview">
                  <span>{t('dashboard.wallet.youWillReceive')}</span>
                  <span className="wallet-card__tokens-amount">{formatTokens(tokensForAmount)}</span>
                  <span className="wallet-card__tokens-label">{t('dashboard.wallet.tokens')}</span>
                </div>

                <button
                  className="wallet-card__submit-btn"
                  onClick={handleTopUp}
                  disabled={isProcessing || topUpAmount <= 0}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin" size={18} />
                      {t('dashboard.wallet.processing')}
                    </>
                  ) : (
                    <>
                      <CreditCard size={18} />
                      {t('dashboard.wallet.payWithCard')}
                    </>
                  )}
                </button>

                <p className="wallet-card__rate-info">
                  {t('dashboard.wallet.rateInfo')}
                </p>
              </>
            ) : (
              <div className="wallet-card__unavailable">
                <AlertCircle size={24} />
                <p>{t('dashboard.wallet.paymentUnavailable')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Payment History Card */}
        <div className="wallet-card wallet-card--full">
          <div className="wallet-card__header">
            <History size={20} />
            <h2>{t('dashboard.wallet.paymentHistory')}</h2>
          </div>
          <div className="wallet-card__content">
            {historyLoading ? (
              <div className="wallet-card__loading">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : paymentHistory.length > 0 ? (
              <div className="wallet-card__history-list">
                {paymentHistory.map((item) => {
                  // Parse metadata to get amountUsd
                  let amountUsd = 0;
                  try {
                    const meta = JSON.parse(item.metadata || '{}');
                    amountUsd = meta.amountUsd || (meta.amountCents ? meta.amountCents / 100 : 0);
                  } catch { /* ignore */ }

                  return (
                    <div key={item.id} className="wallet-card__history-item">
                      <div className="wallet-card__history-info">
                        <span className="wallet-card__history-tokens">
                          +{formatTokens(item.amount_tokens)} {t('dashboard.wallet.tokens')}
                        </span>
                        <span className="wallet-card__history-date">
                          {formatDate(new Date(item.created_at).toISOString())}
                        </span>
                      </div>
                      <div className="wallet-card__history-amount">
                        {formatCurrency(amountUsd)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="wallet-card__empty">
                <p>{t('dashboard.wallet.noHistory')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
