import React from 'react';
import './Skeleton.css';

// Base skeleton component for creating loading placeholders
const Skeleton = ({ width, height, borderRadius, className = '', variant = 'rect' }) => {
  const style = {
    width: width || '100%',
    height: height || '1em',
    borderRadius: borderRadius || (variant === 'circle' ? '50%' : '8px')
  };

  return <div className={`skeleton ${variant} ${className}`} style={style} />;
};

// Message bubble skeleton for chat loading
export const MessageSkeleton = ({ isUser = false }) => {
  return (
    <div className={`message-skeleton ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-skeleton-content">
        <Skeleton width="80%" height="16px" className="mb-8" />
        <Skeleton width="100%" height="16px" className="mb-8" />
        <Skeleton width="60%" height="16px" />
      </div>
    </div>
  );
};

// Chat area skeleton for initial load
export const ChatSkeleton = () => {
  return (
    <div className="chat-skeleton">
      <div className="chat-skeleton-messages">
        <MessageSkeleton isUser={true} />
        <MessageSkeleton isUser={false} />
        <MessageSkeleton isUser={true} />
        <MessageSkeleton isUser={false} />
      </div>
    </div>
  );
};

// Template library skeleton for loading templates
export const TemplateLibrarySkeleton = () => {
  return (
    <div className="template-skeleton">
      {/* Search bar skeleton */}
      <Skeleton height="44px" className="mb-20" />

      {/* Category skeletons */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="template-category-skeleton">
          <div className="template-category-header-skeleton">
            <Skeleton width="150px" height="20px" />
            <Skeleton width="24px" height="24px" variant="circle" />
          </div>

          {/* Template items */}
          <div className="template-items-skeleton">
            {[1, 2, 3].map((j) => (
              <div key={j} className="template-item-skeleton">
                <div className="template-item-left">
                  <Skeleton width="32px" height="32px" borderRadius="6px" />
                  <div className="template-item-text">
                    <Skeleton width="180px" height="16px" className="mb-6" />
                    <Skeleton width="120px" height="14px" />
                  </div>
                </div>
                <Skeleton width="24px" height="24px" borderRadius="6px" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// Typing indicator skeleton for message sending
export const TypingSkeleton = () => {
  return (
    <div className="typing-skeleton">
      <div className="typing-skeleton-content">
        <div className="typing-dots">
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
      </div>
    </div>
  );
};

export default Skeleton;
