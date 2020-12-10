const core = require('@actions/core');
const sinon = require('sinon');
const { readFileSync } = require('fs');
const { resolve: resolvePath } = require('path');

const run = require('../src/linked-project-columns');
const api = require('../src/api');

describe('linked-project-columns', () => {
  const processEnv = process.env;
  const token = 'token';
  const sourceColumnId = 'source';
  const targetColumnId = 'target';

  const getColumnsFixture = readFileSync(resolvePath(__dirname, './fixtures/get-project-columns.json'), {
    encoding: 'utf8'
  });
  const deleteCardFixture = readFileSync(resolvePath(__dirname, './fixtures/delete-project-card.json'), {
    encoding: 'utf8'
  });
  const addCardFixture = readFileSync(resolvePath(__dirname, './fixtures/add-project-card.json'), {
    encoding: 'utf8'
  });
  const moveCardFixture = readFileSync(resolvePath(__dirname, './fixtures/move-project-card.json'), {
    encoding: 'utf8'
  });

  let getColumnsResponse;
  let sourceColumns;
  let targetColumn;

  beforeEach(() => {
    process.env = {
      ...process.env,
      INPUT_GITHUB_TOKEN: token,
      INPUT_SOURCE_COLUMN_ID: sourceColumnId,
      INPUT_TARGET_COLUMN_ID: targetColumnId
    };

    sinon.stub(core, 'setFailed');
    sinon.stub(core, 'warning');

    getColumnsResponse = JSON.parse(getColumnsFixture);
    sourceColumns = getColumnsResponse.sourceColumns;
    targetColumn = getColumnsResponse.targetColumn;

    sinon.stub(api, 'setAPI');
    sinon.stub(api, 'getProjectColumns').returns(getColumnsResponse);
    sinon.stub(api, 'deleteCardAtIndex').callsFake((column, index) => {
      const response = JSON.parse(deleteCardFixture);
      response.deleteProjectCard.deletedCardId = column.cards.nodes[index].id;
      return Promise.resolve(response.deleteProjectCard.deletedCardId);
    });
    sinon.stub(api, 'moveCardToIndex').callsFake((column, fromIndex) => {
      const response = JSON.parse(moveCardFixture);
      const card = column.cards.nodes[fromIndex];
      response.moveProjectCard.cardEdge.node.id = card.id;
      if (card.note) {
        response.moveProjectCard.cardEdge.node.note = card.note;
      }
      if (card.content) {
        response.moveProjectCard.cardEdge.node.content = card.content;
      }

      return Promise.resolve(response.moveProjectCard.cardEdge.node);
    });

    let newId = 200;
    sinon.stub(api, 'addCardToColumn').callsFake((column, card) => {
      const response = JSON.parse(addCardFixture);
      response.addProjectCard.cardEdge.node.id = newId;
      newId += 1;
      if (card.note) {
        response.addProjectCard.cardEdge.node.note = card.note;
      }
      if (card.content) {
        response.addProjectCard.cardEdge.node.content = card.content;
      }

      return Promise.resolve(response.addProjectCard.cardEdge.node);
    });
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
  });

  it('throws an error when github token is not given', async () => {
    delete process.env.INPUT_GITHUB_TOKEN;

    await run();

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: github_token']);
  });

  it('throws an error when source column id is not given', async () => {
    delete process.env.INPUT_SOURCE_COLUMN_ID;

    await run();

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: source_column_id']);
  });

  it('throws an error when target column id is not given', async () => {
    delete process.env.INPUT_TARGET_COLUMN_ID;

    await run();

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: target_column_id']);
  });

  it('queries for source and target column information', async () => {
    await run();

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.getProjectColumns.callCount).toEqual(1);
    expect(api.getProjectColumns.getCall(0).args).toEqual([
      [process.env.INPUT_SOURCE_COLUMN_ID],
      process.env.INPUT_TARGET_COLUMN_ID
    ]);
  });

  it('adds an automation notice to the target column when enabled', async () => {
    process.env.INPUT_AUTOMATION_NOTICE = 'true';
    await run();

    expect(targetColumn.cards.nodes[0]).toMatchObject({
      note: expect.stringMatching(/<!-- automation-notice -->/)
    });

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args[1]).toMatchObject({
      note: expect.stringMatching(/<!-- automation-notice -->/)
    });
  });

  it('adds source column notices to the target column when enabled', async () => {
    process.env.INPUT_SOURCE_COLUMN_NOTICES = 'true';
    await run();

    expect(targetColumn.cards.nodes[0]).toMatchObject({
      note: expect.stringMatching(`<!-- column-notice: ${sourceColumns[0].id} -->`)
    });

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args[1]).toMatchObject({
      note: expect.stringMatching(`<!-- column-notice: ${sourceColumns[0].id} -->`)
    });
  });

  it('does not add notices to the target column when disabled', async () => {
    await run();
    expect(targetColumn.cards.nodes.length).toEqual(0);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(0);
  });

  it('deletes cards from the target column that are not in source', async () => {
    sourceColumns[0].cards.nodes.push({ id: 3, note: '3' });
    targetColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' }, { id: 3, note: '3' });

    await run();

    expect(targetColumn.cards.nodes).toEqual([{ id: 3, note: '3' }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.deleteCardAtIndex.callCount).toEqual(2);
    expect(api.deleteCardAtIndex.getCall(0).args).toEqual([targetColumn, 2]);
    expect(api.deleteCardAtIndex.getCall(1).args).toEqual([targetColumn, 1]);
  });

  it('adds cards from the source to the target', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([
      { id: 200, note: '1' },
      { id: 201, note: '2' }
    ]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(2);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: '1' }]);
    expect(api.addCardToColumn.getCall(1).args).toEqual([targetColumn, { id: 2, note: '2' }]);

    // cards are by default added at index 0, and the second added card needs
    // to be moved to the end of the column
    expect(api.moveCardToIndex.callCount).toEqual(1);
    expect(api.moveCardToIndex.getCall(0).args).toEqual([targetColumn, 0, 1]);
  });

  it('does not add a card to the local target column when the remote call fails', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' });
    // when the remote call fails, addCardToColumn returns null.  overwrite
    // the default method stub to return null.
    api.addCardToColumn.returns(null);

    await run();
    expect(targetColumn.cards.nodes).toEqual([]);

    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: '1' }]);
    expect(api.moveCardToIndex.callCount).toEqual(0);
  });

  it('moves cards on the target to match the source', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });
    targetColumn.cards.nodes.push({ id: 202, note: '2' }, { id: 201, note: '1' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([
      { id: 201, note: '1' },
      { id: 202, note: '2' }
    ]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.moveCardToIndex.callCount).toEqual(1);
    expect(api.moveCardToIndex.getCall(0).args).toEqual([targetColumn, 1, 0]);
  });

  it('adds, moves and deletes cards to sync columns', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });
    targetColumn.cards.nodes.push({ id: 201, note: '3' }, { id: 203, note: '4' }, { id: 202, note: '2' });

    await run();

    expect(targetColumn.cards.nodes).toEqual([
      { id: 200, note: '1' },
      { id: 202, note: '2' }
    ]);
  });

  it('filters source cards to note type', async () => {
    process.env.INPUT_TYPE_FILTER = 'note';
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, content: { id: 1000 } });

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ id: 200, note: '1' }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: '1' }]);
  });

  it('filters source cards to content type', async () => {
    process.env.INPUT_TYPE_FILTER = 'content';
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, content: { id: 1000 } });

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ id: 200, content: { id: 1000 } }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 2, content: { id: 1000 } }]);
  });

  it('filters source content cards based on labels', async () => {
    process.env.INPUT_LABEL_FILTER = 'label 2';
    const matchingCard = {
      id: 2,
      content: {
        id: 1002,
        labels: {
          nodes: [{ name: 'label 2' }]
        }
      }
    };

    sourceColumns[0].cards.nodes.push(
      {
        id: 1,
        content: {
          id: 1001,
          labels: {
            nodes: [{ name: 'label 1' }]
          }
        }
      },
      { ...matchingCard },
      {
        id: 3,
        content: {
          id: 1003,
          labels: {
            nodes: [{ name: 'label 3' }]
          }
        }
      }
    );

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ ...matchingCard, id: 200 }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, matchingCard]);
  });

  it('does not filter source note cards based on labels', async () => {
    process.env.INPUT_LABEL_FILTER = '1, 2, other';
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ id: 200, note: '1' }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: '1' }]);
  });

  it('filters source note cards based on note content', async () => {
    process.env.INPUT_CONTENT_FILTER = '1, note 2, other';
    sourceColumns[0].cards.nodes.push(
      {
        id: 1,
        note: 'note 1'
      },
      {
        id: 2,
        note: 'note 2'
      },
      {
        id: 3,
        note: 'note 3'
      }
    );

    await run();
    expect(targetColumn.cards.nodes).toEqual([
      { id: 200, note: 'note 1' },
      { id: 201, note: 'note 2' }
    ]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(2);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: 'note 1' }]);
    expect(api.addCardToColumn.getCall(1).args).toEqual([targetColumn, { id: 2, note: 'note 2' }]);
  });

  it('filters source content cards based on title content', async () => {
    process.env.INPUT_CONTENT_FILTER = '1, title 2, other';
    sourceColumns[0].cards.nodes.push(
      {
        id: 1,
        content: {
          id: 1001,
          title: 'title 1'
        }
      },
      {
        id: 2,
        content: {
          id: 1002,
          title: 'title 2'
        }
      },
      {
        id: 3,
        content: {
          id: 1003,
          title: 'title 3'
        }
      }
    );

    await run();
    expect(targetColumn.cards.nodes).toEqual([
      { id: 200, content: { id: 1001, title: 'title 1' } },
      { id: 201, content: { id: 1002, title: 'title 2' } }
    ]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(2);
    expect(api.addCardToColumn.getCall(0).args).toEqual([
      targetColumn,
      { id: 1, content: { id: 1001, title: 'title 1' } }
    ]);
    expect(api.addCardToColumn.getCall(1).args).toEqual([
      targetColumn,
      { id: 2, content: { id: 1002, title: 'title 2' } }
    ]);
  });

  it('filters source content cards based on state', async () => {
    process.env.INPUT_STATE_FILTER = 'open';
    sourceColumns[0].cards.nodes.push(
      {
        id: 1,
        content: {
          id: 1001,
          state: 'OPEN'
        }
      },
      {
        id: 2,
        content: {
          id: 1002,
          state: 'CLOSED'
        }
      }
    );

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ id: 200, content: { id: 1001, state: 'OPEN' } }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([
      targetColumn,
      { id: 1, content: { id: 1001, state: 'OPEN' } }
    ]);
  });

  it('does not filter source note cards based on state', async () => {
    process.env.INPUT_STATE_FILTER = 'open';
    sourceColumns[0].cards.nodes.push({ id: 1, note: 'CLOSED' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([{ id: 200, note: 'CLOSED' }]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);

    expect(api.addCardToColumn.callCount).toEqual(1);
    expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: 'CLOSED' }]);
  });

  it('filters source content cards with ignore comments', async () => {
    sourceColumns[0].cards.nodes.push({
      id: 1,
      content: { id: 1001, body: 'test\n<!-- mirror ignore -->\ntest' }
    });

    await run();
    expect(targetColumn.cards.nodes).toEqual([]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(0);
  });

  it('filters source note cards with ignore comments', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: 'test\n<!-- mirror ignore -->\ntest' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.addCardToColumn.callCount).toEqual(0);
  });

  it('filters target content cards with ignore comments', async () => {
    targetColumn.cards.nodes.push({
      id: 1,
      content: { id: 1001, body: 'test\n<!-- mirror ignore -->\ntest' }
    });

    await run();
    // we expect to filter out cards locally, but not to delete them from
    // the remote
    expect(targetColumn.cards.nodes).toEqual([]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.deleteCardAtIndex.callCount).toEqual(0);
  });

  it('filters target note cards with ignore comments', async () => {
    targetColumn.cards.nodes.push({ id: 1, note: 'test\n<!-- mirror ignore -->\ntest' });

    await run();
    expect(targetColumn.cards.nodes).toEqual([]);

    expect(core.warning.callCount).toEqual(0);
    expect(core.setFailed.callCount).toEqual(0);
    expect(api.deleteCardAtIndex.callCount).toEqual(0);
  });

  describe('with multiple source columns', () => {
    const secondSourceColumnId = 'second';

    beforeEach(() => {
      process.env.INPUT_SOURCE_COLUMN_ID = `${sourceColumnId},${secondSourceColumnId}`;
      sourceColumns.push({
        id: 3,
        name: 'second source column',
        url: 'https://example.com/projects/1/columns/3',
        project: {
          name: 'source project'
        },
        cards: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null
          }
        }
      });
    });

    it('adds cards from all sources to the target', async () => {
      sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });
      sourceColumns[1].cards.nodes.push({ id: 3, note: '3' }, { id: 4, note: '4' });

      await run();
      expect(targetColumn.cards.nodes).toEqual([
        { id: 200, note: '1' },
        { id: 201, note: '2' },
        { id: 202, note: '3' },
        { id: 203, note: '4' }
      ]);

      expect(core.warning.callCount).toEqual(0);
      expect(core.setFailed.callCount).toEqual(0);

      expect(api.getProjectColumns.callCount).toEqual(1);
      expect(api.getProjectColumns.getCall(0).args).toEqual([[sourceColumnId, secondSourceColumnId], targetColumnId]);

      expect(api.addCardToColumn.callCount).toEqual(4);
      expect(api.addCardToColumn.getCall(0).args).toEqual([targetColumn, { id: 1, note: '1' }]);
      expect(api.addCardToColumn.getCall(1).args).toEqual([targetColumn, { id: 2, note: '2' }]);
      expect(api.addCardToColumn.getCall(2).args).toEqual([targetColumn, { id: 3, note: '3' }]);
      expect(api.addCardToColumn.getCall(3).args).toEqual([targetColumn, { id: 4, note: '4' }]);
    });

    it('deletes cards from the target column that are not in any sources', async () => {
      sourceColumns[0].cards.nodes.push({ id: 1, note: '1' });
      sourceColumns[1].cards.nodes.push({ id: 2, note: '2' });
      targetColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' }, { id: 3, note: '3' });

      await run();
      expect(targetColumn.cards.nodes).toEqual([
        { id: 1, note: '1' },
        { id: 2, note: '2' }
      ]);

      expect(core.warning.callCount).toEqual(0);
      expect(core.setFailed.callCount).toEqual(0);

      expect(api.deleteCardAtIndex.callCount).toEqual(1);
      expect(api.deleteCardAtIndex.getCall(0).args).toEqual([targetColumn, 2]);
    });

    it('adds column headers for all columns when enabled', async () => {
      process.env.INPUT_SOURCE_COLUMN_NOTICES = 'true';
      sourceColumns[0].cards.nodes.push({ id: 1, note: '1' });
      sourceColumns[1].cards.nodes.push({ id: 3, note: '2' });

      await run();
      expect(targetColumn.cards.nodes).toMatchObject([
        { id: 200, note: expect.stringMatching(`<!-- column-notice: ${sourceColumns[0].id} -->`) },
        { id: 201, note: '1' },
        { id: 202, note: expect.stringMatching(`<!-- column-notice: ${sourceColumns[1].id} -->`) },
        { id: 203, note: '2' }
      ]);

      expect(core.warning.callCount).toEqual(0);
      expect(core.setFailed.callCount).toEqual(0);
    });
  });
});
