const core = require('@actions/core');
const octokit = require('@octokit/graphql');
const api = require('./api');
const utils = require('./utils');

// Find a card in an array of cards based on it's linked content, or it's note.
// Returns an array of [found card, index of found card]
function findCard(column, card) {
  let index = -1;
  const cards = column.cards.nodes;
  if (card.content) {
    index = cards.findIndex(targetCard => targetCard.content && targetCard.content.id === card.content.id);
  } else {
    index = cards.findIndex(targetCard => targetCard.note && targetCard.note === card.note);
  }

  if (index < 0) {
    return [null, index];
  }

  return [cards[index], index];
}

async function ensureCardAtIndex(column, toIndex, findCardFunc, newCardFunc) {
  core.info("before ensure card");
  core.info(column.cards.nodes.map(c => {
    if (!c) {
      return null;
    } else if (c.content) {
      return c.content.title;
    } else {
      return c.note;
    }
  }));
  let [card, currentIndex] = findCardFunc();
  if (!card) {
    // add card to remote project column cards
    card = await api.addCardToColumn(column, newCardFunc());
    currentIndex = 0;

    // add the card to the local column cards
    column.cards.nodes.splice(0, 0, card);
  }

  if (card && currentIndex !== toIndex) {
    // move card in remote project column cards
    card = await api.moveCardToIndex(column, currentIndex, toIndex);

    // remove the card from it's original index
    column.cards.nodes.splice(currentIndex, 1);
    // and add the card returned from moveCard at the destination index
    column.cards.nodes.splice(toIndex, 0, card);
  }

  core.info("after ensure card");
  core.info(column.cards.nodes.map(c => {
    if (!c) {
      return null;
    } else if (c.content) {
      return c.content.title;
    } else {
      return c.note;
    }
  }));

  return card;
}

// Apply an array of filters to an array of cards.
// Returns an array of filtered cards.  Does not mutate the original cards array.
function applyFilters(cards, filterFunctions) {
  return filterFunctions.reduce((result, filter) => filter(result), cards);
}

async function run() {
  // try {
  const sourceColumnIds = utils.getInputList(core.getInput('source_column_id', { required: true }));
  const targetColumnId = core.getInput('target_column_id', { required: true });
  const addSourceColumnNotes = core.getInput('source_column_notices').toLowerCase() === 'true';
  const addAutomationNote = core.getInput('automation_notice').toLowerCase() === 'true';

  api.setAPI(
    octokit.graphql.defaults({
      headers: {
        authorization: `token ${core.getInput('github_token', { required: true })}`
      }
    })
  );

  const { sourceColumns, targetColumn } = await api.getProjectColumns(sourceColumnIds, targetColumnId);

  // filter ignored cards from the target column
  targetColumn.cards.nodes = applyFilters(targetColumn.cards.nodes, [utils.filters.ignored]);
  // apply all filters to source columns
  // eslint-disable-next-line no-restricted-syntax
  for (const sourceColumn of sourceColumns) {
    sourceColumn.cards.nodes = applyFilters(sourceColumn.cards.nodes, [...Object.values(utils.filters)]);
  }

  let targetIndex = 0;

  // ensure the automation note is in the correct position if enabled
  if (addAutomationNote) {
    const card = await ensureCardAtIndex(
      targetColumn,
      targetIndex,
      () => utils.findAutomationNote(targetColumn),
      () => ({ note: utils.newAutomationNote(sourceColumns) })
    );

    if (card) {
      targetIndex += 1;
    }
  }

  // make sure the target column matches the contents from all source columns
  // eslint-disable-next-line no-restricted-syntax
  for (const sourceColumn of sourceColumns) {
    // ensure that source column notes are in the correct position if enabled
    if (addSourceColumnNotes) {
      // this for loop cannot be parallelized, as it is dependent on ordering
      // eslint-disable-next-line no-await-in-loop
      const card = await ensureCardAtIndex(
        targetColumn,
        targetIndex,
        () => utils.findColumnHeaderNote(targetColumn, sourceColumn),
        () => ({ note: utils.newColumnHeaderNote(sourceColumn) })
      );

      if (card) {
        targetIndex += 1;
      }
    }

    // sync the contents from the source column to the correct position in the
    // target column
    // eslint-disable-next-line no-restricted-syntax
    for (const sourceCard of sourceColumn.cards.nodes) {
      // this for loop cannot be parallelized, as it is dependent on ordering
      // eslint-disable-next-line no-await-in-loop
      const card = await ensureCardAtIndex(
        targetColumn,
        targetIndex,
        () => findCard(targetColumn, sourceCard),
        () => sourceCard
      );

      if (card) {
        targetIndex += 1;
      }
    }
  }

  // delete remaining cards
  while (targetColumn.cards.nodes.length > targetIndex) {
    const deleteIndex = targetColumn.cards.nodes.length - 1;
    // remove the card from the remote column
    // this for loop cannot be parallelized, as it is dependent on ordering
    // eslint-disable-next-line no-await-in-loop
    await api.deleteCardAtIndex(targetColumn, deleteIndex);

    // remove the card from the local column
    targetColumn.cards.nodes.splice(deleteIndex, 1);
  }
  // } catch (error) {
  //   core.setFailed(error.message);
  // }
}

module.exports = run;
