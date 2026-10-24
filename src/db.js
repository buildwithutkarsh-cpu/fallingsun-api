const mongoose = require('mongoose');
const C = require('./config');
const { Schema, model } = mongoose;

const toJSON = {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => { delete ret._id; return ret; },
};
const opts = { toJSON, timestamps: true };

const teamSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  leader: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, enum: C.CATEGORIES, required: true },
  project_title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 2000 },
  link: { type: String, maxlength: 300 },
  status: { type: String, enum: ['active', 'robotics_selected', 'robotics_eliminated', 'transferred'], default: 'active' },
  members: [new Schema({ name: { type: String, required: true } }, { _id: false })], // names only, they do not log in
  // kind 'skill' (4 per team) or 'tool' (1 per team). "completed" comes from the Trial tab of the sheet
  tracks: [new Schema({
    kind: { type: String, enum: ['skill', 'tool'], required: true },
    track: { type: String, required: true },
    completed: { type: Boolean, default: false },
  }, { _id: false })],
}, opts);
teamSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
teamSchema.index({ leader: 1 }, { unique: true }); // one team per leader

// Accounts are mirrored from the Google Sheet (Leaders + Jury tabs).
const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  role: { type: String, enum: ['leader', 'jury'], required: true },
  active: { type: Boolean, default: true }, // false when removed from the sheet
  team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  password_hash: { type: String, select: false },
}, opts);

// NOTE: no default on "submissions" - it is managed with $inc during upsert
const voteSchema = new Schema({
  voter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  voter_team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  source: { type: String, enum: ['jury', 'leader'], required: true },
  scores: { type: [Number], validate: (a) => a.length === 5 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 5) },
  total: { type: Number, required: true },
  submissions: Number,
}, opts);
voteSchema.index({ voter: 1, team: 1 }, { unique: true }); // one vote counts per project
voteSchema.index({ team: 1, source: 1 });
voteSchema.index({ voter_team: 1, source: 1 });

const presentationSchema = new Schema({
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  score: { type: Number, min: 0, max: 5, required: true },
  submissions: Number,
}, opts);
presentationSchema.index({ reviewer: 1, team: 1 }, { unique: true });

const ideationSchema = new Schema({
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  scores: { type: [Number], validate: (a) => a.length === 5 },
  total: { type: Number, required: true },
}, opts);
ideationSchema.index({ reviewer: 1, team: 1 }, { unique: true });

// Every vote create / edit is logged
const auditSchema = new Schema({
  kind: { type: String, enum: ['vote', 'presentation'] },
  action: { type: String, enum: ['create', 'update'] },
  voter: Schema.Types.ObjectId,
  team: Schema.Types.ObjectId,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ip: String,
}, opts);
auditSchema.index({ voter: 1, createdAt: -1 });

const settingSchema = new Schema({ key: { type: String, unique: true }, value: String }, opts);

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hackathon');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes
}

module.exports = {
  connect,
  Team: model('Team', teamSchema),
  User: model('User', userSchema),
  Vote: model('Vote', voteSchema),
  PresentationScore: model('PresentationScore', presentationSchema),
  IdeationScore: model('IdeationScore', ideationSchema),
  VoteAudit: model('VoteAudit', auditSchema),
  Setting: model('Setting', settingSchema),
};
