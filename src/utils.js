const core = require('@actions/core');

// content filters are parsed from a string either as wrapped in quotes or comma separated
const INPUT_LIST_REGEX = /\s*(?:((["'])([^\2]+?)\2)|([^"',]+))\s*/g;
function getInputList(input) {
  if (!input) {
    return [];
  }

  return [...input.matchAll(INPUT_LIST_REGEX)]
    .map(match => match[3] || match[4])
    .map(filter => filter.trim())
    .filter(filter => !!filter);
}

function filterByType(cards) {
  const typeFilter = core.getInput('type_filter', { required: false });
  if (typeFilter === 'note') {
    return cards.filter(card => !!card.note);
  }
  if (typeFilter === 'content') {
    return cards.filter(card => !!card.content);
  }
  if (typeFilter) {
    core.warning(`cannot apply unknown type_filter ${typeFilter}`);
  }

  return cards;
}

function filterByContent(cards) {
  let contentFilters = getInputList(core.getInput('content_filter', { required: false }));
  if (contentFilters.length === 0) {
    return cards;
  }

  // match content in case-insensitive manner
  contentFilters = contentFilters.map(filter => new RegExp(filter, 'i'));

  // filter to cards with displayed text content that matches at least one
  // of the user-supplied filters
  return cards.filter(card => {
    if (card.content) {
      return contentFilters.some(filter => filter.test(card.content.title));
    }
    if (card.note) {
      return contentFilters.some(filter => filter.test(card.note));
    }

    // don't filter cards that cannot be filtered by content
    return true;
  });
}

function filterByLabel(cards) {
  const labelFilters = getInputList(core.getInput('label_filter', { required: false }));
  if (labelFilters.length === 0) {
    return cards;
  }

  return cards.filter(card => {
    if (card.content) {
      // only include cards for issues and PRs that have a matching label
      return card.content.labels.nodes.some(label => labelFilters.includes(label.name));
    }

    // don't filter cards that can't be filtered by labels
    return true;
  });
}

function filterByState(cards) {
  let stateFilter = core.getInput('state_filter', { required: false });
  if (!stateFilter) {
    return cards;
  }

  stateFilter = stateFilter.toUpperCase();
  return cards.filter(card => {
    if (card.content) {
      // only include cards for issues and PRs in a matching state
      return card.content.state === stateFilter;
    }

    // don't filter cards that can't be filtered by state
    return true;
  });
}

const IGNORE_COMMENT = '<!-- mirror ignore -->';
function filterIgnored(cards) {
  return cards.filter(card => {
    if (card.note) {
      // don't include cards that have the ignore comment in the note
      return !card.note.includes(IGNORE_COMMENT);
    }

    if (card.content && card.content.body) {
      // don't include cards that have the ignore comment in content body
      return !card.content.body.includes(IGNORE_COMMENT);
    }

    // do not filter cards that can't include ignored stamps
    return true;
  });
}

module.exports = {
  getInputList,
  filters: {
    type: filterByType,
    content: filterByContent,
    label: filterByLabel,
    state: filterByState,
    ignored: filterIgnored
  }
};
