import express from 'express'
import cors from 'cors'
import TelegramBot from 'node-telegram-bot-api'
import path from 'path'

import { ObjectId } from 'mongodb'
import pickRandom from 'pick-random'
import { difference } from "set-operations"
import moment from 'moment'

import { validateClass } from './types.js'
import { scc, runQuery } from './db.js'
import { updateObject, objectMap2Array, objecFilter } from '../utils/object.js'
import { getClassTimeIndex, getCurrentWeekTimeInfo, classTimes } from '../utils/time.js'

import { TG_TOKEN, SECRET_KEY, GROUP_CHATID } from './config.js'

// init services --------------------------
const __dirname = path.resolve()

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('./dist'))

const bot = new TelegramBot(TG_TOKEN, { polling: true })

// app data ------------------------------------

let
  classes = {}, // class_id => class
  program = [] // array of day | day is array of time | time is array of class_ids

function resetProgram() {
  program = []
  for (let di = 0; di < 7; di++) { // day index
    program[di] = []

    for (let ti = 0; ti < 7; ti++) // time index
      program[di][ti] = []
  }
}

function processData(classesArray) {
  resetProgram()

  for (let di = 0; di < 7; di++) { // day index
    for (let ti = 0; ti < 7; ti++) { // time index
      program[di][ti] =
        classesArray
          .filter(cls => cls.program[di].includes(ti))
          .map(cls => cls["_id"])
    }
  }

  classes = classesArray.reduce((o, cls) => updateObject(o, cls["_id"], cls), {})
}

// database connection

async function updateData() {
  processData(
    await runQuery(
      async () => await scc.find().toArray()))
}

async function upsertClass(clsObject, clsId) {
  let result = await runQuery(
    async () => await scc.updateOne(
      { _id: ObjectId(clsId) },
      { $set: clsObject },
      { upsert: true }
    ))

  await updateData()
  return result
}

// web service --------------------------------------

function checkSecretKey(next) {
  return (req, res) => {
    if (req.headers["secret-key"] === SECRET_KEY)
      next(req, res)
    else
      res.status(401).send({ msg: "you are not an admin", headers: req.headers })
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', '/page.html'))
})


app.get('/api/now', (req, res) => {
  res.send(moment().format())
})
app.get('/api/getAll', async (req, res) => {
  res.send({ classes, program })
})
app.post('/api/update', async (req, res) => {
  await updateData()
  res.send({ result: "ok" })
})

app.post('/api/verify', (req, res) => {
  res.send({ result: req.body.secretKey === SECRET_KEY })
})

app.post('/api/class', checkSecretKey(async (req, res) => {
  let errors = validateClass(req.body)
  if (errors.length === 0)
    res.send(await upsertClass(req.body, ObjectId()))

  else res.status(400).send(errors)
}))
app.put('/api/class/:cid', checkSecretKey(async (req, res) => {
  let errors = validateClass(req.body)
  if (errors.length === 0)
    res.send(await upsertClass(req.body, req.params.cid))

  else res.status(400).send(errors)
}))
app.delete('/api/class/:cid', checkSecretKey(async (req, res) => {
  let dbRes = await runQuery(async () => await scc.deleteOne({ _id: ObjectId(req.params.cid) }))
  await updateData()
  res.send(dbRes)
}))

app.post('/api/bot/', checkSecretKey((req, res) => {
  send2Group(req.body.msg)
  res.send(req.body)
}))


app.listen(3000, async () => {
  console.log('running ...')
  await updateData()
  runScheduler()
})

// telegram bot -------------------------
function send2Group(msg) {
  bot.sendMessage(GROUP_CHATID, msg)
}

bot.on("message", (msg) => {
  function send(text) {
    bot.sendMessage(msg.chat.id, text)
  }

  if (msg.text.startsWith('/start'))
    send([
      "دستورات:",
      "\n\n",
      "/check",
      "بررسی وضعیت",
      "\n",
      "/classes",
      "کلاس های در حال برگزاری",
    ].join(' '))

  else if (msg.text.startsWith('/check'))
    send(pickRandom([
      "جانم فدایتان اعلی حضرت",
      "شما امر بفرما",
      "حواسمو پرت نکن",
      "عهههههه دارم کار میکنم",
      "چییییههه؟",
      "ساکت لطفا",
    ])[0])

  else if (msg.text.startsWith('/classes') ){
    let currentClasses = currentClassIds(getCurrentWeekTimeInfo()).map(cid => classes[cid])
    send([
      "هم اکنون",
      currentClasses.length,
      "کلاس در حال برگزاری است",
      "\n\n-----------------------\n",
      "کلاس ها:",
      "\n",
      currentClasses.map((cls, i) => `\n${i+1} -> ${getClassShortInfo(cls)}`).join("\n")
    ].join(' '))
  }
})

// --------------------------------


let lastClassIds = []

function getClassShortInfo(cls) {
  return [
    "کلاس",
    cls["lesson"],
    "با",
    cls["teacher"]
  ].join(' ')
}

function currentClassIds(now) {
  let classTimeIndex = getClassTimeIndex(now.mtime, classTimes)

  return objectMap2Array(
    objecFilter(
      classes,
      (_, cls) => cls.program[now.dayIndex].includes(classTimeIndex)
    ),
    (id, cls) => id)
}

function task() {
  console.log('task')

  let newClassIds = currentClassIds(getCurrentWeekTimeInfo())

  for (const clsId of difference(newClassIds, lastClassIds)) {
    const cls = classes[clsId]
    send2Group([
      getClassShortInfo(cls),
      "در حال برگزاری است",
    ].join(' '))
  }

  lastClassIds = newClassIds
}

function runScheduler() {
  task()
  return setInterval(task, 60 * 1000)
}