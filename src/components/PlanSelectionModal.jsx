import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import './PlanSelectionModal.css';

const PlanSelectionModal = ({ isOpen, onClose, currentPlan, userStatus, onPlanChange }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' or 'yearly'

  const plans = [
    {
      id: 'individual',
      name: 'Individual',
      pricing: {
        monthly: {
          price: 3400,
          currency: 'RSD',
          period: 'mesec'
        },
        yearly: {
          price: 34000,
          originalPrice: 40800, // 12 * 3400
          currency: 'RSD',
          period: 'godina',
          discount: 17
        }
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
      popular: false,
      disabled: false,
      target: 'Za redovne korisnike'
    },
    {
      id: 'professional',
      name: 'Professional',
      pricing: {
        monthly: {
          price: 6400,
          currency: 'RSD',
          period: 'mesec'
        },
        yearly: {
          price: 64000,
          originalPrice: 76800, // 12 * 6400
          currency: 'RSD',
          period: 'godina',
          discount: 17
        }
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
      popular: true,
      disabled: false,
      target: 'Za advokate i agente za nekretnine'
    },
    {
      id: 'team',
      name: 'Team',
      pricing: {
        monthly: {
          price: 24900,
          currency: 'RSD',
          period: 'mesec'
        },
        yearly: {
          price: 249000,
          originalPrice: 298800, // 12 * 24900
          currency: 'RSD',
          period: 'godina',
          discount: 17
        }
      },
      features: [
        { text: 'Sve funkcije iz Professional paketa', enabled: true },
        { text: 'Upravljanje timom', enabled: true },
        { text: 'Do 5 korisnika', enabled: true },
        { text: 'Prioritetna podrška', enabled: true },
        { text: 'Napredne funkcije za timove', enabled: true },
      ],
      popular: false,
      disabled: false,
      target: 'Za veće timove i institucije'
    }
  ];

  const getCurrentPlanId = () => {
    if (!userStatus?.access_type) return 'trial';
    switch (userStatus.access_type) {
      case 'individual': return 'individual';
      case 'professional': return 'professional';
      case 'team': return 'team';
      case 'premium': return 'professional'; // Migrate premium to professional
      default: return 'trial';
    }
  };


  const handleUpgrade = async (planId) => {
    if (getCurrentPlanId() === planId) {
      onClose();
      return;
    }

    setIsProcessing(true);
    const selectedPlan = plans.find(p => p.id === planId);
    const selectedPlanData = {
      ...selectedPlan,
      selectedBillingPeriod: billingPeriod,
      selectedPricing: selectedPlan.pricing[billingPeriod]
    };
    
    try {
      setProcessingMessage('Pokretamo proces plaćanja...');
      // Placeholder for payment processing
      setTimeout(async () => {
        setProcessingMessage('Ažuriramo vaš nalog...');
        
        // Call the upgrade function
        if (onPlanChange) {
          await onPlanChange(planId, selectedPlanData);
        }
        
        setIsProcessing(false);
        onClose();
      }, 3000);
    } catch (error) {
      console.error('Plan upgrade error:', error);
      alert('Došlo je do greške prilikom nadogradnje plana. Molimo pokušajte ponovo.');
      setIsProcessing(false);
    }
  };

  const formatPrice = (price, currency, period) => {
    if (price === null) return 'Kontakt';
    if (price === 0) return 'Besplatno';
    return `${price.toLocaleString('sr-RS')} ${currency}/${period}`;
  };

  const getPlanPricing = (plan) => {
    return plan.pricing[billingPeriod];
  };

  const getDiscountText = (yearlyPricing) => {
    if (yearlyPricing.discount) {
      return `Ušteda ${yearlyPricing.discount}%`;
    }
    return null;
  };

  const getMonthlyEquivalent = (yearlyPrice) => {
    return Math.round(yearlyPrice / 12);
  };

  const getBadgeColor = (type) => {
    switch (type) {
      case 'current': return 'current';
      case 'recommended': return 'recommended';
      case 'contact': return 'contact';
      default: return 'default';
    }
  };

  const isCurrentPlan = (planId) => {
    return planId === getCurrentPlanId();
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Izaberite Plan"
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
            {userStatus?.messages_remaining === 0 && (
              <div className="auth-reason-message">
                <div className="reason-icon">
                  <Icon name="info" size={20} />
                </div>
                <div className="reason-text">
                  <strong>Potrošili ste sve probne poruke</strong>
                  <p>Izaberite plan da nastavite korišćenje aplikacije.</p>
                </div>
              </div>
            )}

            {/* Billing Period Toggle */}
            <div className="billing-toggle-container">
              <div className="billing-toggle">
                <button 
                  className={`billing-option ${billingPeriod === 'monthly' ? 'active' : ''}`}
                  onClick={() => setBillingPeriod('monthly')}
                >
                  Mesečno
                </button>
                <button 
                  className={`billing-option ${billingPeriod === 'yearly' ? 'active' : ''}`}
                  onClick={() => setBillingPeriod('yearly')}
                >
                  Godišnje
                  <span className="discount-badge">Ušteda 17%</span>
                </button>
              </div>
            </div>

            <div className="plans-grid multi-plan">
              {plans.map((plan) => {
                const currentPricing = getPlanPricing(plan);
                return (
                  <div
                    key={plan.id}
                    className={`plan-card ${isCurrentPlan(plan.id) ? 'current-plan' : ''} ${plan.popular ? 'popular' : ''}`}
                  >
                    {plan.popular && <div className="popular-badge">Popularno</div>}

                    <div className="plan-header">
                      <h3 className="plan-name">{plan.name}</h3>
                      <div className="plan-target">{plan.target}</div>
                      <div className="plan-price-container">
                        <div className="plan-price">
                          {formatPrice(currentPricing.price, currentPricing.currency, currentPricing.period)}
                        </div>
                        {billingPeriod === 'yearly' && (
                          <div className="monthly-equivalent">
                            {getMonthlyEquivalent(currentPricing.price).toLocaleString('sr-RS')} RSD/mesec
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="plan-features">
                      {plan.features.map((feature, index) => (
                        <div key={index} className={`feature-item ${!feature.enabled ? 'disabled' : ''}`}>
                          <span className="feature-icon">
                            {feature.enabled ? (
                              <Icon name="check" size={14} color="white" />
                            ) : (
                              <span>✗</span>
                            )}
                          </span>
                          <span className="feature-text">{feature.text}</span>
                        </div>
                      ))}
                    </div>

                    <div className="plan-action">
                      <button
                        className={`btn-plan ${isCurrentPlan(plan.id) ? 'current' : 'upgrade'}`}
                        onClick={() => handleUpgrade(plan.id)}
                        disabled={isCurrentPlan(plan.id)}
                      >
                        {isCurrentPlan(plan.id) ? 'Trenutni plan' : `Izaberi ${plan.name}`}
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>
                Otkaži
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default PlanSelectionModal;