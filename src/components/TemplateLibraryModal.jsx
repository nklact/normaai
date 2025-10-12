import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import { TemplateLibrarySkeleton } from './Skeleton';
import './TemplateLibraryModal.css';

const TemplateLibraryModal = ({ isOpen, onClose, userStatus, onOpenAuthModal, onOpenPlanSelection, isAuthenticated }) => {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const categoryRefs = useRef({});

  // Load templates data on mount
  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/templates.json');
      const data = await response.json();
      setCategories(data.categories || []);
      setTemplates(data.templates || []);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if user has at least Individual plan
  const hasRequiredPlan = () => {
    return userStatus && ['individual', 'professional', 'team', 'premium'].includes(userStatus.access_type);
  };

  // Toggle category expansion
  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => {
      const isExpanding = !prev.includes(categoryId);

      // If expanding, scroll to it after state update
      if (isExpanding) {
        setTimeout(() => {
          categoryRefs.current[categoryId]?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });
        }, 100);
      }

      return prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId];
    });
  };

  // Group templates by category with search filtering
  const getGroupedTemplates = () => {
    const query = searchQuery.trim().toLowerCase();

    return categories.map(category => {
      let categoryTemplates = templates.filter(t => t.category === category.id);

      // Apply search filter
      if (query) {
        categoryTemplates = categoryTemplates.filter(t => {
          const templateName = t.name.toLowerCase();
          const categoryName = category.name.toLowerCase();
          return templateName.includes(query) || categoryName.includes(query);
        });
      }

      return {
        ...category,
        templates: categoryTemplates,
        hasResults: categoryTemplates.length > 0
      };
    }).filter(category => category.hasResults);
  };

  const groupedTemplates = getGroupedTemplates();

  // Auto-expand categories with search results
  useEffect(() => {
    if (searchQuery.trim()) {
      const categoriesWithResults = groupedTemplates.map(g => g.id);
      setExpandedCategories(categoriesWithResults);
    } else {
      setExpandedCategories([]);
    }
  }, [searchQuery, templates]);

  const handleDownload = (template) => {
    // Check if user has required plan
    if (!hasRequiredPlan()) {
      // If not authenticated, show auth modal
      if (!isAuthenticated) {
        onClose();
        onOpenAuthModal();
        return;
      }

      // If authenticated but no plan, show plan selection
      onClose();
      onOpenPlanSelection();
      return;
    }

    // Trigger download
    const link = document.createElement('a');
    link.href = template.path;
    link.download = template.filename || template.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ugovori i Obrasci" type="template-library">
      <div className="template-library-content">
        {/* Search bar */}
        <div className="template-search">
          <Icon name="search" size={18} />
          <input
            type="text"
            placeholder="Pretraži sve dokumente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="template-search-input"
          />
        </div>

        {/* Accordion-style categories */}
        <div className="template-accordion">
          {isLoading ? (
            <TemplateLibrarySkeleton />
          ) : groupedTemplates.length > 0 ? (
            groupedTemplates.map((category) => (
              <div
                key={category.id}
                className="category-section"
                ref={el => categoryRefs.current[category.id] = el}
              >
                <button
                  className="category-header"
                  onClick={() => toggleCategory(category.id)}
                >
                  <div className="category-header-content">
                    <span className="category-name">{category.name}</span>
                    <span className="category-count">({category.templates.length})</span>
                  </div>
                  <Icon
                    name={expandedCategories.includes(category.id) ? "chevronUp" : "chevronDown"}
                    size={18}
                  />
                </button>

                {expandedCategories.includes(category.id) && (
                  <div className="category-templates">
                    {category.templates.map((template) => (
                      <div
                        key={template.id}
                        className="template-item"
                        onClick={() => handleDownload(template)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleDownload(template);
                          }
                        }}
                        title={hasRequiredPlan() ? "Preuzmi dokument" : "Potreban je Individual plan ili viši"}
                      >
                        <div className="template-info">
                          <div className="template-icon">📄</div>
                          <div className="template-details">
                            <h4 className="template-name">{template.name}</h4>
                            {template.description && (
                              <p className="template-description">{template.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="template-download-btn">
                          <Icon name="download" size={18} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="templates-empty">
              <p>Nema rezultata pretrage</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default TemplateLibraryModal;
