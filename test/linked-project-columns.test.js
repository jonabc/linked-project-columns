const core = require('@actions/core');
const octokit = require('@octokit/graphql');
const sinon = require('sinon');
const { readFileSync } = require('fs');
const { resolve: resolvePath } = require('path');

const run = require('../src/linked-project-columns');
const queries = require('../src/graphql');

describe('linked-project-columns', () => {
  const processEnv = process.env;
  const token = 'token';
  const sourceColumnId = 'source';
  const targetColumnId = 'target';

  let api;
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

  beforeEach(() => {
    process.env = {
      ...process.env,
      INPUT_GITHUB_TOKEN: token,
      INPUT_SOURCE_COLUMN_ID: sourceColumnId,
      INPUT_TARGET_COLUMN_ID: targetColumnId
    };

    sinon.spy(core, 'setFailed');

    api = sinon.stub();
    sinon.stub(octokit.graphql, 'defaults').returns(api);

    getColumnsResponse = JSON.parse(getColumnsFixture);

    api.withArgs(queries.GET_PROJECT_COLUMNS).resolves(getColumnsResponse);
    api.withArgs(queries.DELETE_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(deleteCardFixture);
      response.deleteProjectCard.deletedCardId = input.cardId;
      return Promise.resolve(response);
    });
    api.withArgs(queries.MOVE_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(moveCardFixture);
      response.moveProjectCard.cardEdge.node.id = input.cardId;
      return Promise.resolve(response);
    });
    let newId = 200;
    api.withArgs(queries.ADD_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(addCardFixture);
      response.addProjectCard.cardEdge.node.id = newId;
      newId += 1;
      if (input.note) {
        response.addProjectCard.cardEdge.node.note = input.note;
      }
      if (input.contentId) {
        response.addProjectCard.cardEdge.node.content = { id: input.contentId };
      }

      return Promise.resolve(response);
    });
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
  });

  it('throws an error when github token is not given', async () => {
    delete process.env.INPUT_GITHUB_TOKEN;

    await run();

    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: github_token']);
  });

  it('throws an error when source column id is not given', async () => {
    delete process.env.INPUT_SOURCE_COLUMN_ID;

    await run();

    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: source_column_id']);
  });

  it('throws an error when target column id is not given', async () => {
    delete process.env.INPUT_TARGET_COLUMN_ID;

    await run();

    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: target_column_id']);
  });

  it('queries for source and target column information', async () => {
    await run();

    expect(api.callCount).toBeGreaterThanOrEqual(1);
    expect(api.getCall(0).args).toContain(queries.GET_PROJECT_COLUMNS);
    expect(core.setFailed.callCount).toEqual(0);
  });

  it('adds an automation note to the target column', async () => {
    await run();

    expect(api.callCount).toEqual(2);
    expect(api.getCall(1).args[0]).toEqual(queries.ADD_PROJECT_CARD);
    expect(api.getCall(1).args[1]).toMatchObject({
      columnId: 2,
      note: expect.stringMatching(/\*\*DO NOT EDIT\*\*/)
    });
    expect(core.setFailed.callCount).toEqual(0);
  });

  it('deletes cards from the target column that are not in source', async () => {
    getColumnsResponse.targetColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // deletions happen before adds
    // call 0 -> get columns
    expect(api.getCall(1).args).toEqual([queries.DELETE_PROJECT_CARD, { cardId: 2 }]);
    expect(api.getCall(2).args).toEqual([queries.DELETE_PROJECT_CARD, { cardId: 1 }]);
    // call 3 -> add automation note
  });

  it('adds cards from the source to the target', async () => {
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(6);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: '1' }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
    expect(api.getCall(4).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: '2' }]);
    expect(api.getCall(5).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 202, afterCardId: 201 }]);
  });

  it('moves cards on the target to match the source', async () => {
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });
    getColumnsResponse.targetColumn.cards.nodes.push({ id: 202, note: '2' }, { id: 201, note: '1' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(3);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('filters source cards to note type', async () => {
    process.env.INPUT_TYPE_FILTER = 'note';
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, content: { id: 1000 } });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: '1' }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('filters source cards to content type', async () => {
    process.env.INPUT_TYPE_FILTER = 'content';
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: '1' }, { id: 2, content: { id: 1000 } });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, contentId: 1000 }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('filters source content cards based on labels', async () => {
    process.env.INPUT_LABEL_FILTER = 'label 2';
    getColumnsResponse.sourceColumn.cards.nodes.push(
      {
        id: 1,
        content: {
          id: 1001,
          labels: {
            nodes: [{ name: 'label 1' }]
          }
        }
      },
      {
        id: 2,
        content: {
          id: 1002,
          labels: {
            nodes: [{ name: 'label 2' }]
          }
        }
      },
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

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, contentId: 1002 }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('does not filter source note cards based on labels', async () => {
    process.env.INPUT_LABEL_FILTER = '1, 2, other';
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: '1' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: '1' }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('filters source note cards based on note content', async () => {
    process.env.INPUT_CONTENT_FILTER = '1, note 2, other';
    getColumnsResponse.sourceColumn.cards.nodes.push(
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

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(6);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: 'note 1' }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
    expect(api.getCall(4).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: 'note 2' }]);
    expect(api.getCall(5).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 202, afterCardId: 201 }]);
  });

  it('filters source content cards based on title content', async () => {
    process.env.INPUT_CONTENT_FILTER = '1, title 2, other';
    getColumnsResponse.sourceColumn.cards.nodes.push(
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

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(6);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, contentId: 1001 }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
    expect(api.getCall(4).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, contentId: 1002 }]);
    expect(api.getCall(5).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 202, afterCardId: 201 }]);
  });

  it('filters source content cards based on state', async () => {
    process.env.INPUT_STATE_FILTER = 'open';
    getColumnsResponse.sourceColumn.cards.nodes.push(
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

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, contentId: 1001 }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('does not filter source note cards based on state', async () => {
    process.env.INPUT_STATE_FILTER = 'open';
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: 'CLOSED' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(4);
    // call 0 -> get columns
    // call 1 -> add automation note
    expect(api.getCall(2).args).toEqual([queries.ADD_PROJECT_CARD, { columnId: 2, note: 'CLOSED' }]);
    expect(api.getCall(3).args).toEqual([queries.MOVE_PROJECT_CARD, { columnId: 2, cardId: 201, afterCardId: 200 }]);
  });

  it('filters source content cards with ignore comments', async () => {
    getColumnsResponse.sourceColumn.cards.nodes.push({
      id: 1,
      content: { id: 1001, body: 'test\n<!-- mirror ignore -->\ntest' }
    });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(2);
    // call 0 -> get columns
    // call 1 -> add automation note
    // no call to add the ignored item from the source column
  });

  it('filters source note cards with ignore comments', async () => {
    getColumnsResponse.sourceColumn.cards.nodes.push({ id: 1, note: 'test\n<!-- mirror ignore -->\ntest' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(2);
    // call 0 -> get columns
    // call 1 -> add automation note
    // no call to add the ignored item from the source column
  });

  it('filters target content cards with ignore comments', async () => {
    getColumnsResponse.targetColumn.cards.nodes.push({
      id: 1,
      content: { id: 1001, body: 'test\n<!-- mirror ignore -->\ntest' }
    });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(2);
    // call 0 -> get columns
    // call 1 -> add automation note
    // no call to delete the item from the target column
  });

  it('filters target note cards with ignore comments', async () => {
    getColumnsResponse.targetColumn.cards.nodes.push({ id: 1, note: 'test\n<!-- mirror ignore -->\ntest' });

    await run();

    expect(core.setFailed.callCount).toEqual(0);
    expect(api.callCount).toEqual(2);
    // call 0 -> get columns
    // call 1 -> add automation note
    // no call to delete the item from the target column
  });
});
