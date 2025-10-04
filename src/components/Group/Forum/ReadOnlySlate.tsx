import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { createEditor } from 'slate';
import {
  withReact,
  Slate,
  Editable,
  RenderElementProps,
  RenderLeafProps,
} from 'slate-react';
import { TIME_MILLISECONDS_250 } from '../../../constants/constants';

type ExtendedRenderElementProps = RenderElementProps & { mode?: string };

export const renderElement = ({
  attributes,
  children,
  element,
  mode,
}: ExtendedRenderElementProps) => {
  switch (element.type) {
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>;
    case 'heading-2':
      return (
        <h2
          className="h2"
          {...attributes}
          style={{ textAlign: element.textAlign }}
        >
          {children}
        </h2>
      );
    case 'heading-3':
      return (
        <h3
          className="h3"
          {...attributes}
          style={{ textAlign: element.textAlign }}
        >
          {children}
        </h3>
      );
    case 'code-block':
      return (
        <pre {...attributes} className="code-block">
          <code>{children}</code>
        </pre>
      );
    case 'code-line':
      return <div {...attributes}>{children}</div>;
    case 'link':
      return (
        <a href={element.url} {...attributes}>
          {children}
        </a>
      );
    default:
      return (
        <p
          className={`paragraph${mode ? `-${mode}` : ''}`}
          {...attributes}
          style={{ textAlign: element.textAlign }}
        >
          {children}
        </p>
      );
  }
};

export const renderLeaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  let el = children;

  if (leaf.bold) {
    el = <strong>{el}</strong>;
  }

  if (leaf.italic) {
    el = <em>{el}</em>;
  }

  if (leaf.underline) {
    el = <u>{el}</u>;
  }

  if (leaf.link) {
    el = (
      <a href={leaf.link} {...attributes}>
        {el}
      </a>
    );
  }

  return <span {...attributes}>{el}</span>;
};

interface ReadOnlySlateProps {
  content: any;
  mode?: string;
}

const ReadOnlySlate: FC<ReadOnlySlateProps> = ({ content, mode }) => {
  const [load, setLoad] = useState(false);
  const editor = useMemo(() => withReact(createEditor()), []);
  const value = useMemo(() => content, [content]);

  const performUpdate = useCallback(async () => {
    setLoad(true);
    try {
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, TIME_MILLISECONDS_250);
      });
    } catch (error) {
      console.log(error);
    }
    setLoad(false);
  }, []);
  useEffect(() => {
    performUpdate();
  }, [value]);

  if (load) return null;

  return (
    <Slate editor={editor} value={value} onChange={() => {}}>
      <Editable
        readOnly
        renderElement={(props) => renderElement({ ...props, mode })}
        renderLeaf={renderLeaf}
      />
    </Slate>
  );
};

export default ReadOnlySlate;
