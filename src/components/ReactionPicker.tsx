import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Picker, { EmojiStyle, Theme } from 'emoji-picker-react';
import './ReactionPicker.css';
import { ButtonBase } from '@mui/material';
import { isMobile } from '../App';

export const ReactionPicker = ({ onReaction }) => {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const pickerRef = useRef(null);
  const buttonRef = useRef(null);

  const handleReaction = (emojiObject) => {
    onReaction(emojiObject.emoji);
    setShowPicker(false);
  };

  const handlePicker = (emojiObject) => {
    onReaction(emojiObject.emoji);
    setShowPicker(false);
  };

  const togglePicker = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (showPicker) {
      setShowPicker(false);
    } else {
      // Get the button's position
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const pickerWidth = isMobile ? 300 : 350; // Adjust based on picker width

      // Calculate position to align the right edge of the picker with the button's right edge
      setPickerPosition({
        top: buttonRect.bottom + window.scrollY, // Position below the button
        left: buttonRect.right + window.scrollX - pickerWidth, // Align right edges
      });
      setShowPicker(true);
    }
  };

  // Close picker if clicked outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setShowPicker(false);
      }
    };

    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPicker]);

  return (
    <div className="reaction-container">
      {/* Emoji CTA */}
      <ButtonBase
        sx={{ fontSize: '22px' }}
        ref={buttonRef}
        onClick={togglePicker}
      >
        😃
      </ButtonBase>

      {/* Emoji Picker rendered in a portal with calculated position */}
      {showPicker &&
        ReactDOM.createPortal(
          <div
            className="emoji-picker"
            ref={pickerRef}
            style={{
              position: 'absolute',
              top: pickerPosition.top,
              left: pickerPosition.left,
              zIndex: 1000,
            }}
          >
            <Picker
              height={isMobile ? 350 : 450}
              width={isMobile ? 300 : 350}
              reactionsDefaultOpen={true}
              onReactionClick={handleReaction}
              onEmojiClick={handlePicker}
              allowExpandReactions={true}
              autoFocusSearch={false}
              theme={Theme.DARK}
              emojiStyle={EmojiStyle.NATIVE}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
