import { useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useTheme } from '@mui/material';

const ResizableImage = ({ node, updateAttributes, selected }) => {
  const imgRef = useRef(null);
  const theme = useTheme();

  const startResizing = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = imgRef.current.offsetWidth;

    const onMouseMove = (e) => {
      const newWidth = startWidth + e.clientX - startX;
      updateAttributes({ width: `${newWidth}px` });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`resizable-image ${selected ? 'selected' : ''}`}
      style={{
        display: 'inline-block',
        position: 'relative',
        userSelect: 'none', // Prevent selection to avoid interference with the text cursor
      }}
    >
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt || ''}
        title={node.attrs.title || ''}
        style={{
          width: node.attrs.width || 'auto',
          display: 'block',
          margin: '0 auto',
        }}
        draggable={false} // Prevent image dragging
      />

      <div
        style={{
          backgroundColor: theme.palette.background.paper,
          bottom: 0,
          cursor: 'nwse-resize',
          height: '10px',
          position: 'absolute',
          right: 0,
          width: '10px',
          zIndex: 1, // Ensure the resize handle is above other content
        }}
        onMouseDown={startResizing}
      ></div>
    </NodeViewWrapper>
  );
};

export default ResizableImage;
