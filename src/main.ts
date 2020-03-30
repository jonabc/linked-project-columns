import * as core from '@actions/core'
import {graphql} from '@octokit/graphql'
import * as queries from './graphql'

const AUTOMATION_NOTE_TEMPLATE: string = `
**DO NOT EDIT**
This column uses automation to mirror the ['<column name>' column](<column url>) from [<project name>](<project url>).
`.trim()

const github = graphql.defaults({
  headers: {
    authorization: `token ${core.getInput('github_token')}`
  }
})

async function getAutomationNote(column: any): Promise<string> {
  core.info(`source column: ${column.name}`)
  core.info(`source project: ${column.project.name}`)
  return AUTOMATION_NOTE_TEMPLATE.replace('<column name>', column.name)
    .replace('<column url>', column.url.replace('/columns/', '#column-'))
    .replace('<project name>', column.project.name)
    .replace('<project url>', column.project.url)
}

function findCard(card: any, column: any): any[] {
  let index
  if (card.content) {
    index = column.cards.nodes.findIndex(
      (targetCard: any): boolean =>
        targetCard.content && targetCard.content.id === card.content.id
    )
  } else {
    index = column.cards.nodes.findIndex(
      (targetCard: any): boolean =>
        targetCard.note && targetCard.note === card.note
    )
  }

  return [column.cards.nodes[index], index]
}

async function ensureCard(
  card: any,
  index: number,
  targetColumn: any
): Promise<any> {
  let [targetCard, targetCardIndex] = findCard(card, targetColumn)
  let afterCardId: string | null = null
  if (index > 0) {
    afterCardId = targetColumn.cards.nodes[index - 1].id
  }

  if (!targetCard) {
    // add!
    core.info(`Creating card in ${targetColumn.name}`)
    const cardData: any = {}
    if (card.content) {
      cardData.contentId = card.content.id
      core.info(`setting content: ${card.content.id}`)
    } else {
      cardData.note = card.note
      core.info(`setting note: ${cardData.note}`)
    }

    const response = await github(queries.ADD_PROJECT_CARD, {
      columnId: targetColumn.id,
      ...cardData
    })

    if (!response) {
      throw new Error(`unable to add card with ${cardData}`)
    }

    // add new card to local array and set index appropriately
    targetCard = response['addProjectCard'].cardEdge.node
    targetColumn.cards.nodes.unshift(targetCard)
    targetCardIndex = 0
    core.info(`created card: ${targetCard.id}`)
    core.info('cards now has:')
    core.info(JSON.stringify(targetColumn.cards.nodes))
    core.info(`new target card index = ${targetCardIndex}`)
  } else {
    core.info(`found card: ${targetCard.id}`)
  }

  core.info(`card at index ${targetCardIndex}, wanted at ${index}`)
  if (targetCardIndex !== index) {
    // move!
    core.info(`moving card: ${targetCard.id}`)
    const moveData = {
      cardId: targetCard.id,
      columnId: targetColumn.id,
      afterCardId
    }

    await github(queries.MOVE_PROJECT_CARD, moveData)

    // update the target column card location in the local card array
    targetColumn.cards.nodes.splice(
      index,
      0,
      targetColumn.cards.nodes.splice(targetCardIndex, 1)[0]
    )
    targetCardIndex = index

    core.info(`moved card: ${targetCard.id} after ${moveData.afterCardId}`)
    core.info(JSON.stringify(targetColumn.cards.nodes))
  }

  return targetCard
}

async function run(): Promise<void> {
  try {
    const sourceColumnId = core.getInput('sourceColumnId')
    const targetColumnId = core.getInput('targetColumnId')

    const response = await github(queries.GET_PROJECT_COLUMNS, {
      sourceColumnId,
      targetColumnId,
      cardLimit: 100
    })
    if (!response) {
      throw new Error('unable to find project columns')
    }

    const sourceColumn = response['sourceColumn']
    const targetColumn = response['targetColumn']

    core.info('sourceColumn')
    core.info(JSON.stringify(sourceColumn))
    core.info('targetColumn')
    core.info(JSON.stringify(targetColumn))

    core.info(`ensuring automation note card`)
    // make sure that a card explaining the automation on the column exists
    // at index 0 in the target column
    const automationNoteCard: any = {
      note: await getAutomationNote(sourceColumn)
    }
    await ensureCard(automationNoteCard, 0, targetColumn)

    core.info(`deleting extra cards from target column`)
    // delete all cards in target column that do not exist in the source column,
    // except for the automation note
    // start at index 1 to account for the automation note card
    for (let index = 1; index < targetColumn.cards.nodes.length; index++) {
      const targetCard = targetColumn.cards.nodes[index]
      const [sourceCard] = findCard(targetCard, sourceColumn)

      if (!sourceCard) {
        await github(queries.DELETE_PROJECT_CARD, {cardId: targetCard.id})
        targetColumn.cards.nodes.splice(index, 1)
      }
    }

    core.info(`syncing cards from source column`)
    // make sure cards from the source column are in target column, in the right
    // order
    for (let index = 0; index < sourceColumn.cards.nodes.length; index++) {
      const sourceCard = sourceColumn.cards.nodes[index]

      // offset the index to account for the automation note always being index
      // 0 in the target column
      await ensureCard(sourceCard, index + 1, targetColumn)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
