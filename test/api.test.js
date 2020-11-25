const core = require('@actions/core');
const sinon = require('sinon');
const { readFileSync } = require('fs');
const { resolve: resolvePath } = require('path');

const api = require('../src/api');

let graphql;

beforeEach(() => {
  graphql = sinon.stub();
  api.setAPI(graphql);
});

afterEach(() => {
  sinon.restore();
  api.setAPI(null);
});

describe('getProjectColumns', () => {
  const getColumnsFixture = readFileSync(resolvePath(__dirname, './fixtures/get-project-columns.json'), {
    encoding: 'utf8'
  });
  const getSingleColumnFixture = readFileSync(resolvePath(__dirname, './fixtures/get-single-project-column.json'), {
    encoding: 'utf8'
  });

  let getColumnsResponse;
  let getSingleColumnResponse;
  let sourceColumns;
  let targetColumn;
  let sourceColumnIds;
  let targetColumnId;

  beforeEach(() => {
    sinon.stub(core, 'warning');
    sinon.stub(core, 'info');

    getColumnsResponse = JSON.parse(getColumnsFixture);
    getSingleColumnResponse = JSON.parse(getSingleColumnFixture);

    sourceColumns = getColumnsResponse.sourceColumns;
    sourceColumnIds = sourceColumns.map(c => c.id);

    targetColumn = getColumnsResponse.targetColumn;
    targetColumnId = targetColumn.id;

    graphql.withArgs(api.queries.GET_PROJECT_COLUMNS).resolves(getColumnsResponse);
    graphql.withArgs(api.queries.GET_SINGLE_PROJECT_COLUMN).resolves(getSingleColumnResponse);
  });

  it('does not include archived cards', async () => {
    await api.getProjectColumns(sourceColumnIds, targetColumnId);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args[0]).toContain('archivedStates: [NOT_ARCHIVED]');
  });

  it('pulls cards from the graphql API', async () => {
    sourceColumns[0].cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });
    sourceColumns.push({
      id: 2,
      name: 'source column 2',
      url: 'https://example.com/projects/1/columns/2',
      project: {
        name: 'source project'
      },
      cards: {
        nodes: [
          { id: 3, note: '3' },
          { id: 4, note: '4' }
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null
        }
      }
    });

    const { sourceColumns: apiSourceColumns, targetColumn: apiTargetColumn } = await api.getProjectColumns(
      sourceColumnIds,
      targetColumnId
    );
    expect(apiSourceColumns[0].cards.nodes).toEqual(sourceColumns[0].cards.nodes);
    expect(apiSourceColumns[1].cards.nodes).toEqual(sourceColumns[1].cards.nodes);
    expect(apiTargetColumn.cards.nodes).toEqual(targetColumn.cards.nodes);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([api.queries.GET_PROJECT_COLUMNS, { sourceColumnIds, targetColumnId }]);
  });

  it('gathers additional pages of cards for source columns', async () => {
    sourceColumns[0].cards.pageInfo.hasNextPage = true;
    sourceColumns[0].cards.pageInfo.endCursor = 'abc';
    getSingleColumnResponse.column.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });

    const { sourceColumns: apiSourceColumns } = await api.getProjectColumns(sourceColumnIds, targetColumnId);
    expect(apiSourceColumns[0].cards.nodes).toEqual(getSingleColumnResponse.column.cards.nodes);

    expect(graphql.callCount).toEqual(2);
    expect(graphql.getCall(0).args).toEqual([api.queries.GET_PROJECT_COLUMNS, { sourceColumnIds, targetColumnId }]);
    expect(graphql.getCall(1).args).toEqual([
      api.queries.GET_SINGLE_PROJECT_COLUMN,
      { id: sourceColumnIds[0], after: 'abc' }
    ]);
  });

  it('gathers additional pages of cards for the target column', async () => {
    targetColumn.cards.pageInfo.hasNextPage = true;
    targetColumn.cards.pageInfo.endCursor = 'abc';
    getSingleColumnResponse.column.cards.nodes.push({ id: 1, note: '1' }, { id: 2, note: '2' });

    const { targetColumn: apiTargetColumn } = await api.getProjectColumns(sourceColumnIds, targetColumnId);
    expect(apiTargetColumn.cards.nodes).toEqual(getSingleColumnResponse.column.cards.nodes);

    expect(graphql.callCount).toEqual(2);
    expect(graphql.getCall(0).args).toEqual([api.queries.GET_PROJECT_COLUMNS, { sourceColumnIds, targetColumnId }]);
    expect(graphql.getCall(1).args).toEqual([
      api.queries.GET_SINGLE_PROJECT_COLUMN,
      { id: targetColumnId, after: 'abc' }
    ]);
  });
});

describe('addCardToColumn', () => {
  const addCardFixture = readFileSync(resolvePath(__dirname, './fixtures/add-project-card.json'), {
    encoding: 'utf8'
  });
  const column = {
    id: 1,
    name: 'source column',
    url: 'https://example.com/projects/1/columns/1',
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
  };
  const newId = 1;

  beforeEach(() => {
    sinon.stub(core, 'warning');

    graphql.withArgs(api.queries.ADD_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(addCardFixture);
      response.addProjectCard.cardEdge.node.id = newId;
      if (input.note) {
        response.addProjectCard.cardEdge.node.note = input.note;
      }
      if (input.contentId) {
        response.addProjectCard.cardEdge.node.content = { id: input.contentId };
      }

      return Promise.resolve(response);
    });
  });

  it('calls the api to add a note card to the remote column', async () => {
    const card = await api.addCardToColumn(column, { note: 'new card' });
    expect(card).toEqual({ id: newId, note: 'new card' });
    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([api.queries.ADD_PROJECT_CARD, { columnId: column.id, note: 'new card' }]);
  });

  it('calls the api to add a content card to the remote column', async () => {
    const card = await api.addCardToColumn(column, { content: { id: 1 } });
    expect(card).toEqual({ id: newId, content: { id: 1 } });
    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([api.queries.ADD_PROJECT_CARD, { columnId: column.id, contentId: 1 }]);
  });

  it('logs a warning if a card cannot be added to the target', async () => {
    graphql.withArgs(api.queries.ADD_PROJECT_CARD).throws(new Error('test error'));

    const card = await api.addCardToColumn(column, { note: 'new card' });
    expect(card).toBeNull();

    expect(core.warning.callCount).toEqual(2);
    expect(core.warning.getCall(0).args).toEqual(
      expect.arrayContaining([expect.stringContaining('Could not add card')])
    );
    expect(core.warning.getCall(1).args).toEqual(['test error']);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([api.queries.ADD_PROJECT_CARD, { columnId: column.id, note: 'new card' }]);
  });
});

describe('moveCardToIndex', () => {
  const moveCardFixture = readFileSync(resolvePath(__dirname, './fixtures/move-project-card.json'), {
    encoding: 'utf8'
  });
  const column = {
    id: 1,
    name: 'source column',
    url: 'https://example.com/projects/1/columns/1',
    project: {
      name: 'source project'
    },
    cards: {
      nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
      pageInfo: {
        hasNextPage: false,
        endCursor: null
      }
    }
  };

  beforeEach(() => {
    graphql.withArgs(api.queries.MOVE_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(moveCardFixture);
      response.moveProjectCard.cardEdge.node.id = input.cardId;
      return Promise.resolve(response);
    });
  });

  it('calls the api to move a card to the beginning of the column', async () => {
    let card = await api.moveCardToIndex(column, 1, 0);
    expect(card.id).toEqual(2);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 2, columnId: column.id, afterCardId: null }
    ]);

    graphql.resetHistory();
    card = await api.moveCardToIndex(column, 2, 0);
    expect(card.id).toEqual(3);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 3, columnId: column.id, afterCardId: null }
    ]);
  });

  it('calls the api to move a card to the middle of the column', async () => {
    let card = await api.moveCardToIndex(column, 0, 1);
    expect(card.id).toEqual(1);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 1, columnId: column.id, afterCardId: 2 }
    ]);

    graphql.resetHistory();
    card = await api.moveCardToIndex(column, 2, 1);
    expect(card.id).toEqual(3);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 3, columnId: column.id, afterCardId: 1 }
    ]);
  });

  it('calls the api to move a card to the end of the column', async () => {
    let card = await api.moveCardToIndex(column, 1, 2);
    expect(card.id).toEqual(2);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 2, columnId: column.id, afterCardId: 3 }
    ]);

    graphql.resetHistory();
    card = await api.moveCardToIndex(column, 0, 2);
    expect(card.id).toEqual(1);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([
      api.queries.MOVE_PROJECT_CARD,
      { cardId: 1, columnId: column.id, afterCardId: 3 }
    ]);
  });
});

describe('deleteCardAtIndex', () => {
  const deleteCardFixture = readFileSync(resolvePath(__dirname, './fixtures/delete-project-card.json'), {
    encoding: 'utf8'
  });
  const column = {
    id: 1,
    name: 'source column',
    url: 'https://example.com/projects/1/columns/1',
    project: {
      name: 'source project'
    },
    cards: {
      nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
      pageInfo: {
        hasNextPage: false,
        endCursor: null
      }
    }
  };

  beforeEach(() => {
    graphql.withArgs(api.queries.DELETE_PROJECT_CARD).callsFake((query, input) => {
      const response = JSON.parse(deleteCardFixture);
      response.deleteProjectCard.deletedCardId = input.cardId;
      return Promise.resolve(response);
    });
  });

  it('calls the api to delete a card', async () => {
    const id = await api.deleteCardAtIndex(column, 0);
    expect(id).toEqual(1);

    expect(graphql.callCount).toEqual(1);
    expect(graphql.getCall(0).args).toEqual([api.queries.DELETE_PROJECT_CARD, { cardId: 1 }]);
  });
});
