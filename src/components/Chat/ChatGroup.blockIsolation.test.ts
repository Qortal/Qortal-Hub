import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import componentSource from './ChatGroup.tsx?raw';
import { buildReticulumInitialHistoryState } from './reticulumInitialHistory';
import { projectReticulumReactionReferences } from '../../utils/reticulumReactionProjection';

// Exercise the component's actual callback wiring without mounting its native
// transports, editors, and providers. Testing only the history reducer would
// miss this regression: it was the caller supplying the wrong exclusion policy.
const source = ts.createSourceFile(
  'ChatGroup.tsx',
  componentSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

const findNodes = (predicate: (node: ts.Node) => boolean) => {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const evaluate = (node: ts.Node, scope: Record<string, unknown>) =>
  runInNewContext(
    ts.transpileModule(`(${node.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    scope
  );

const callback = (name: string, scope: Record<string, unknown>) => {
  const declarations = findNodes(
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(source) === name
  ) as ts.VariableDeclaration[];
  expect(declarations).toHaveLength(1);
  const initializer = declarations[0].initializer as ts.CallExpression;
  return evaluate(initializer.arguments[0], scope);
};

const parent = {
  signature: 'parent',
  eventType: 'message',
  sender: 'PolarBear',
  message: 'Original message',
};
const reply = {
  signature: 'reply',
  eventType: 'message',
  sender: 'Other',
  message: 'Reply',
  repliedTo: 'parent',
};

const visibility = (hidden = false) => ({
  // A node-wide legacy block must not even be consulted by Reticulum.
  isChatSenderBlocked: vi.fn((item) => item?.sender === parent.sender),
  isReticulumHiddenAuthor: (address: unknown) =>
    hidden && address === parent.sender,
});

describe('ChatGroup transport block isolation', () => {
  it.each([false, true])(
    'uses only Reticulum hiding in initial and incremental history (hidden=%s)',
    (hidden) => {
      const predicates = findNodes(
        (node) =>
          ts.isPropertyAssignment(node) &&
          node.name.getText(source) === 'shouldExclude'
      ) as ts.PropertyAssignment[];
      expect(predicates).toHaveLength(2);
      for (const predicate of predicates) {
        const scope = visibility(hidden);
        const shouldExclude = evaluate(predicate.initializer, scope);
        const result = buildReticulumInitialHistoryState([parent, reply], {
          shouldExclude,
        });
        expect(result.messages.map((item) => item.signature)).toEqual(
          hidden ? ['reply'] : ['parent', 'reply']
        );
        expect(scope.isChatSenderBlocked).not.toHaveBeenCalled();
      }
    }
  );

  it.each([false, true])(
    'uses only Reticulum hiding for live messages (hidden=%s)',
    (hidden) => {
      const scope = visibility(hidden);
      let messages = [];
      const apply = callback('applyReticulumChatItem', {
        ...scope,
        setMessages: (update) => {
          messages = update(messages);
        },
      });
      apply(parent);
      apply(reply);
      expect(messages.map((item) => item.signature)).toEqual(
        hidden ? ['reply'] : ['parent', 'reply']
      );
      expect(scope.isChatSenderBlocked).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'uses only Reticulum hiding for reactions (hidden=%s)',
    (hidden) => {
      const scope = visibility(hidden);
      const project = callback('reticulumReactionReferences', {
        ...scope,
        reticulumChatEnabled: true,
        projectReticulumReactionReferences,
        reticulumChatEvents: [
          {
            eventId: 'reaction',
            eventType: 'reaction_add',
            authorAddress: parent.sender,
            targetEventId: parent.signature,
            timestamp: 1,
            encryptedPayload: JSON.stringify({ content: '👍' }),
          },
        ],
      });
      const references = project();
      expect(Object.keys(references)).toEqual(hidden ? [] : ['parent']);
      expect(scope.isChatSenderBlocked).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'limits Core block-update events to legacy chat (Reticulum=%s)',
    (reticulumChatEnabled) => {
      const scope = visibility();
      let messages = [parent, reply];
      const onBlockUpdate = callback('updateChatMessagesWithBlocksFunc', {
        ...scope,
        reticulumChatEnabled,
        setMessages: (update) => {
          messages = update(messages);
        },
      });
      onBlockUpdate({ detail: true });
      expect(messages.map((item) => item.signature)).toEqual(
        reticulumChatEnabled ? ['parent', 'reply'] : ['reply']
      );
      expect(scope.isChatSenderBlocked).toHaveBeenCalledTimes(
        reticulumChatEnabled ? 0 : 2
      );
    }
  );
});
