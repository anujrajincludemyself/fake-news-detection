const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    content: {
      type: String,
      required: [true, 'News content is required'],
      trim: true,
    },
    sourceUrl: {
      type: String,
      trim: true,
      default: '',
    },
    analysisType: {
      type: String,
      enum: ['text', 'image', 'video'],
      default: 'text',
    },
    mediaFilename: {
      type: String,
      trim: true,
      default: '',
    },
    prediction: {
      label: {
        type: String,
        enum: ['REAL', 'FAKE', 'UNCERTAIN', 'AUTHENTIC', 'MANIPULATED'],
        required: true,
      },
      confidence: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
      details: {
        sentimentScore: { type: Number, default: 0 },
        subjectivityScore: { type: Number, default: 0 },
        credibilityIndicators: {
          hasClickbait: { type: Boolean, default: false },
          hasEmotionalLanguage: { type: Boolean, default: false },
          hasSourceAttribution: { type: Boolean, default: false },
          hasStatisticalClaims: { type: Boolean, default: false },
          readabilityScore: { type: Number, default: 0 },
        },
        analysisType: { type: String, default: 'text' },
        mediaDetails: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    },
    feedback: {
      isCorrect: { type: Boolean, default: null },
      userLabel: {
        type: String,
        enum: ['REAL', 'FAKE', null],
        default: null,
      },
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

analysisSchema.index({ user: 1, createdAt: -1 });
analysisSchema.index({ 'prediction.label': 1 });
analysisSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Analysis', analysisSchema);
