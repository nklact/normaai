import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import './TemplateLibraryModal.css';

const TemplateLibraryModal = ({ isOpen, onClose, userStatus, onOpenAuthModal, onOpenPlanSelection, isAuthenticated }) => {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

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

      // Auto-select first category if none selected
      if (!selectedCategory && data.categories.length > 0) {
        setSelectedCategory(data.categories[0].id);
      }
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

  // Filter templates by category and search query
  const getFilteredTemplates = () => {
    let filtered = templates;

    // Filter by selected category
    if (selectedCategory) {
      filtered = filtered.filter(t => t.category === selectedCategory);
    }

    // Filter by search query (search in template names and category names)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => {
        const templateName = t.name.toLowerCase();
        const categoryName = categories.find(c => c.id === t.category)?.name.toLowerCase() || '';
        return templateName.includes(query) || categoryName.includes(query);
      });
    }

    return filtered;
  };

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

  const filteredTemplates = getFilteredTemplates();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ugovori i Obrasci" type="template-library">
      <div className="template-library-content">
        {/* Search bar */}
        <div className="template-search">
          <Icon name="search" size={18} />
          <input
            type="text"
            placeholder="Pretraži dokumente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="template-search-input"
          />
        </div>

        {/* Category tabs */}
        <div className="template-categories">
          {categories.map((category) => (
            <button
              key={category.id}
              className={`category-tab ${selectedCategory === category.id ? 'active' : ''}`}
              onClick={() => setSelectedCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Templates list */}
        <div className="templates-list">
          {isLoading ? (
            <div className="templates-loading">
              <div className="loading-spinner"></div>
              <p>Učitavanje dokumenata...</p>
            </div>
          ) : filteredTemplates.length > 0 ? (
            filteredTemplates.map((template) => (
              <div key={template.id} className="template-item">
                <div className="template-info">
                  <div className="template-icon">📄</div>
                  <div className="template-details">
                    <h4 className="template-name">{template.name}</h4>
                    {template.description && (
                      <p className="template-description">{template.description}</p>
                    )}
                  </div>
                </div>
                <button
                  className="template-download-btn"
                  onClick={() => handleDownload(template)}
                  title={hasRequiredPlan() ? "Preuzmi dokument" : "Potreban je Individual plan ili viši"}
                >
                  <Icon name="download" size={18} />
                </button>
              </div>
            ))
          ) : (
            <div className="templates-empty">
              <p>Trenutno nema dokumenata u ovoj kategoriji</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default TemplateLibraryModal;
