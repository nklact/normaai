import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import apiService from '../services/api';
import './PlanSelectionModal.css'; // Reuse existing styles

const SubscriptionManagementModal = ({ isOpen, onClose, userStatus, onSubscriptionChange }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [billingPeriod, setBillingPeriod] = useState(() => {
    const subType = userStatus?.subscription_type;
    // Default to monthly if not set or invalid
    return (subType === 'monthly' || subType === 'yearly') ? subType : 'monthly';
  });
  const [showPlanChange, setShowPlanChange] = useState(false);

  // Update billingPeriod when userStatus changes
  useEffect(() => {
    const subType = userStatus?.subscription_type;
    // Only update if valid, otherwise keep current or default to monthly
    if (subType === 'monthly' || subType === 'yearly') {
      setBillingPeriod(subType);
    }
  }, [userStatus?.subscription_type]);

  const formatPrice = (price, currency, period) => {
    if (price === null) return 'Kontakt';
    if (price === 0) return 'Besplatno';
    return `${price.toLocaleString('sr-RS')} ${currency}/${period}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('sr-Latn-RS', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatAccountStatus = (status) => {
    const statusMap = {
      'active': 'Aktivna',
      'cancelled': 'Otkazana',
      'suspended': 'Suspendovana',
      'pending': 'Na čekanju'
    };
    return statusMap[status] || status;
  };

  const formatAccountType = (accountType) => {
    const typeMap = {
      'premium': 'Professional', // Legacy premium users
      'professional': 'Professional',
      'individual': 'Individual',
      'team': 'Team',
      'trial_registered': 'Probni period',
      'trial_unregistered': 'Probni period'
    };
    return typeMap[accountType] || accountType;
  };

  const getCurrentPlanPricing = () => {
    const accessType = userStatus?.access_type || userStatus?.account_type;

    const planPricing = {
      individual: {
        monthly: { price: 3400, currency: 'RSD' },
        yearly: { price: 34000, currency: 'RSD' }
      },
      professional: {
        monthly: { price: 6400, currency: 'RSD' },
        yearly: { price: 64000, currency: 'RSD' }
      },
      team: {
        monthly: { price: 24900, currency: 'RSD' },
        yearly: { price: 249000, currency: 'RSD' }
      },
      premium: { // Legacy support
        monthly: { price: 6400, currency: 'RSD' },
        yearly: { price: 64000, currency: 'RSD' }
      }
    };

    return planPricing[accessType] || planPricing.professional;
  };

  const getAvailablePlans = () => {
    const currentAccessType = userStatus?.access_type || userStatus?.account_type;

    return [
      {
        id: 'individual',
        name: 'Individual',
        isCurrent: currentAccessType === 'individual',
        pricing: {
          monthly: { price: 3400, currency: 'RSD' },
          yearly: { price: 34000, currency: 'RSD' }
        },
        features: [
          { text: '20 poruka mesečno', enabled: true },
          { text: 'Osnovna pravna pomoć', enabled: true },
          { text: 'Reference na zakone', enabled: true },
          { text: 'Generisanje ugovora', enabled: false },
          { text: 'Analiza dokumenata', enabled: false },
          { text: 'Glasovna pitanja', enabled: false },
          { text: 'Email podrška', enabled: true },
        ],
        target: 'Za redovne korisnike'
      },
      {
        id: 'professional',
        name: 'Professional',
        isCurrent: ['professional', 'premium'].includes(currentAccessType),
        pricing: {
          monthly: { price: 6400, currency: 'RSD' },
          yearly: { price: 64000, currency: 'RSD' }
        },
        features: [
          { text: 'Neograničen broj poruka', enabled: true },
          { text: 'Napredni pravni saveti', enabled: true },
          { text: 'Reference na zakone', enabled: true },
          { text: 'Generisanje ugovora', enabled: true },
          { text: 'Analiza dokumenata', enabled: true },
          { text: 'Glasovna pitanja', enabled: true },
          { text: 'Email podrška', enabled: true },
        ],
        target: 'Za advokate i agente za nekretnine'
      },
      {
        id: 'team',
        name: 'Team',
        isCurrent: currentAccessType === 'team',
        pricing: {
          monthly: { price: 24900, currency: 'RSD' },
          yearly: { price: 249000, currency: 'RSD' }
        },
        features: [
          { text: 'Sve funkcije iz Professional paketa', enabled: true },
          { text: 'Upravljanje timom', enabled: true },
          { text: 'Do 5 korisnika', enabled: true },
          { text: 'Prioritetna podrška', enabled: true },
          { text: 'Napredne funkcije za timove', enabled: true },
        ],
        target: 'Za veće timove i institucije'
      }
    ];
  };

  const handleBillingChange = async (newBillingPeriod) => {
    if (newBillingPeriod === billingPeriod) return;

    setIsProcessing(true);
    setProcessingMessage('Menjamo period naplate...');

    try {
      await apiService.changeBillingPeriod(newBillingPeriod);
      setBillingPeriod(newBillingPeriod);
      setProcessingMessage('Period naplate je uspešno promenjen');
      setTimeout(() => {
        setIsProcessing(false);
        if (onSubscriptionChange) {
          onSubscriptionChange('billing_period_changed', { newPeriod: newBillingPeriod });
        }
      }, 1000);
    } catch (error) {
      console.error('Billing change error:', error);
      setProcessingMessage('Greška prilikom promene perioda naplate');
      setTimeout(() => setIsProcessing(false), 2000);
    }
  };

  const handlePlanChange = async (newPlanId) => {
    if (!confirm(`Da li ste sigurni da želite da promenite plan na ${newPlanId}?`)) return;

    setIsProcessing(true);
    setProcessingMessage('Menjamo vaš plan...');

    try {
      // Call the API directly to change the plan
      await apiService.changePlan(newPlanId, billingPeriod);

      setProcessingMessage('Plan je uspešno promenjen');
      setTimeout(() => {
        setIsProcessing(false);
        setShowPlanChange(false);
        // Notify parent to refresh user status
        if (onSubscriptionChange) {
          onSubscriptionChange('plan_change', {
            newPlan: newPlanId,
            billingPeriod: billingPeriod
          });
        }
      }, 1500);
    } catch (error) {
      console.error('Plan change error:', error);
      setProcessingMessage(`Greška: ${error.message}`);
      setTimeout(() => setIsProcessing(false), 3000);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Da li ste sigurni da želite da otkažete pretplatu?')) return;

    setIsProcessing(true);
    setProcessingMessage('Otkazujemo pretplatu...');

    try {
      await apiService.cancelSubscription();
      setProcessingMessage('Pretplata je uspešno otkazana');
      setTimeout(() => {
        setIsProcessing(false);
        if (onSubscriptionChange) {
          onSubscriptionChange('cancelled');
        }
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Cancellation error:', error);
      setProcessingMessage('Greška prilikom otkazivanja pretplate');
      setTimeout(() => setIsProcessing(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Upravljanje Pretplatom"
      type="plan-selection"
    >
      <div className="plan-selection-content">
        {isProcessing ? (
          <div className="processing-overlay">
            <div className="processing-spinner"></div>
            <p className="processing-message">{processingMessage}</p>
          </div>
        ) : (
          <>

            {/* Plan Change Section */}
            {showPlanChange ? (
              <div className="subscription-plan-change-section">
                <div className="section-header">
                  <h3>Promena plana</h3>
                  <button
                    className="back-btn"
                    onClick={() => setShowPlanChange(false)}
                  >
                    <Icon name="arrowLeft" size={16} />
                    Nazad
                  </button>
                </div>
                <div className="plan-change-grid">
                  {getAvailablePlans().map((plan) => (
                    <div
                      key={plan.id}
                      className={`plan-change-card ${plan.isCurrent ? 'current' : ''}`}
                    >
                      <div className="plan-change-header">
                        <h4>{plan.name}</h4>
                        {plan.isCurrent && <span className="current-plan-badge">Trenutni</span>}
                      </div>
                      <div className="plan-target">{plan.target}</div>
                      <div className="plan-change-pricing">
                        <div className="monthly-price">
                          {formatPrice(plan.pricing.monthly.price, plan.pricing.monthly.currency, 'mesec')}
                        </div>
                        <div className="yearly-price">
                          {formatPrice(plan.pricing.yearly.price, plan.pricing.yearly.currency, 'godina')}
                        </div>
                      </div>
                      <div className="plan-features">
                        {plan.features.map((feature, index) => (
                          <div key={index} className={`feature-item ${!feature.enabled ? 'disabled' : ''}`}>
                            <span className="feature-icon">
                              {feature.enabled ? (
                                <Icon name="check" size={14} />
                              ) : (
                                <span>✗</span>
                              )}
                            </span>
                            <span className="feature-text">{feature.text}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        className={`plan-change-btn ${plan.isCurrent ? 'current' : 'change'}`}
                        onClick={() => plan.isCurrent ? null : handlePlanChange(plan.id)}
                        disabled={plan.isCurrent}
                      >
                        {plan.isCurrent ? 'Trenutni plan' : `Promeni na ${plan.name}`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Billing Period Section */}
                <div className="subscription-billing-section">
                  <h3>Promena perioda naplate</h3>
                  <p className="subscription-billing-description">
                    Možete promeniti period naplate u bilo kom trenutku. Promena će stupiti na snagu od sledeće naplate.
                  </p>
                  <div className="subscription-billing-options">
                    {(() => {
                      const currentPricing = getCurrentPlanPricing();
                      const monthlyEquivalent = Math.round(currentPricing.yearly.price / 12);
                      const yearlySavings = (currentPricing.monthly.price * 12) - currentPricing.yearly.price;

                      return (
                        <>
                          <div
                            className={`subscription-billing-card ${billingPeriod === 'monthly' ? 'active' : ''}`}
                            onClick={() => handleBillingChange('monthly')}
                          >
                            <div className="subscription-billing-header">
                              <div className="subscription-billing-title">Mesečno</div>
                              {billingPeriod === 'monthly' && <div className="subscription-current-badge">Trenutno</div>}
                            </div>
                            <div className="subscription-billing-price">
                              {formatPrice(currentPricing.monthly.price, currentPricing.monthly.currency, 'mesec')}
                            </div>
                          </div>

                          <div
                            className={`subscription-billing-card ${billingPeriod === 'yearly' ? 'active' : ''}`}
                            onClick={() => handleBillingChange('yearly')}
                          >
                            <div className="subscription-billing-header">
                              <div className="subscription-billing-title">Godišnje</div>
                              <div className="subscription-discount-badge">-17%</div>
                              {billingPeriod === 'yearly' && <div className="subscription-current-badge">Trenutno</div>}
                            </div>
                            <div className="subscription-billing-price">
                              {formatPrice(currentPricing.yearly.price, currentPricing.yearly.currency, 'godina')}
                            </div>
                            <div className="subscription-billing-equivalent">
                              {monthlyEquivalent.toLocaleString('sr-RS')} RSD/mesec
                            </div>
                            <div className="subscription-billing-savings">
                              Ušteda {yearlySavings.toLocaleString('sr-RS')} RSD
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Plan Management Section */}
                <div className="subscription-plan-section">
                  <h3>Upravljanje planom</h3>
                  <p className="subscription-plan-description">
                    Promenite vaš plan da biste dobili pristup dodatnim funkcijama.
                  </p>
                  <button
                    className="change-plan-btn"
                    onClick={() => setShowPlanChange(true)}
                  >
                    <Icon name="refresh" size={16} />
                    Promeni plan
                  </button>
                </div>
              </>
            )}

            {/* Subscription Info */}
            <div className="subscription-info">
              <h3>Informacije o pretplati</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Trenutni plan:</span>
                  <span className="info-value">
                    {formatAccountType(userStatus?.account_type)}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">Sledeća naplata:</span>
                  <span className="info-value">{formatDate(userStatus?.next_billing_date)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Iznos:</span>
                  <span className="info-value">
                    {(() => {
                      try {
                        const currentPricing = getCurrentPlanPricing();
                        const period = (billingPeriod === 'monthly' || billingPeriod === 'yearly') ? billingPeriod : 'monthly';
                        const pricing = currentPricing[period];
                        if (!pricing) return 'N/A';
                        return formatPrice(pricing.price, pricing.currency, period === 'monthly' ? 'mesec' : 'godina');
                      } catch (error) {
                        console.error('Error formatting price:', error);
                        return 'N/A';
                      }
                    })()}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">Status pretplate:</span>
                  <span className={`info-value ${userStatus?.subscription_status === 'active' ? 'active' : ''}`}>
                    {formatAccountStatus(userStatus?.subscription_status)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="subscription-actions">
              <button
                className="cancel-subscription-btn"
                onClick={handleCancelSubscription}
              >
                <Icon name="close" size={16} />
                Otkaži pretplatu
              </button>
            </div>

            <div className="subscription-note">
              <p>
                <strong>Napomena:</strong> Prilikom otkazivanja pretplate, zadržaćete pristup Premium funkcijama do kraja trenutnog perioda naplate.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default SubscriptionManagementModal;