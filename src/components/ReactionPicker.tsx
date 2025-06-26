import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Picker, { EmojiStyle, Theme } from 'emoji-picker-react';
import '../styles/ReactionPicker.css';
import { ButtonBase } from '@mui/material';

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
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const pickerWidth = 350;
      const pickerHeight = 400; // Match Picker height prop

      // Initial position (below the button)
      let top = buttonRect.bottom + window.scrollY;
      let left = buttonRect.right + window.scrollX - pickerWidth;

      // If picker would overflow bottom, show it above the button
      const overflowBottom =
        top + pickerHeight > window.innerHeight + window.scrollY;
      if (overflowBottom) {
        top = buttonRect.top + window.scrollY - pickerHeight;
      }

      // Optional: prevent overflow on the left too
      if (left < 0) left = 0;

      setPickerPosition({ top, left });
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
              allowExpandReactions={true}
              autoFocusSearch={false}
              emojiStyle={EmojiStyle.NATIVE}
              height={400}
              onEmojiClick={handlePicker}
              onReactionClick={handleReaction}
              theme={Theme.DARK}
              width={350}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
