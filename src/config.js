module.exports = {
  CATEGORIES: ['game', 'web', 'robotics'],

  // Trial = 25 pts: 4 skill tracks (5 each = 20) + 1 tool track (5)
  SKILL_TRACKS: {
    video_editing: 'Video Editing',
    design_3d: '3D Design',
    self_craft_art: 'Self Craft Art',
    music_design: 'Music Design',
    ai_integration: 'AI Integration',
  },
  TOOLS: {
    ziva: 'Ziva',
    cloudflare: 'Cloudflare as Hosting Platform',
    mini_micro: 'Mini Micro as Game Engine',
    angularjs: 'AngularJS as Web Framework',
    arduino: 'Arduino IDE',
    firebase: 'Firebase for Backend',
    kicad: 'KiCad for Cadding',
  },
  SKILL_TRACKS_PER_TEAM: 4,
  POINTS_PER_TRACK: 5,

  // Rating criteria, 5 points each (25 total)
  CRITERIA: {
    game: ['Fun and engagement', 'Gameplay Mechanics', 'Visual Design', 'Audio and Sound Design', 'Replayability and Polish'],
    web: ['UI/UX and Usability', 'Frontend', 'Backend', 'Idea and Problem Solving', 'Replayability and Polish'],
    robotics: ['Functionality', 'Engineering and Integration', 'Innovation and Problem Solving', 'Practicality', 'Reliability and Testing'],
  },

  // Robotics ideation round
  IDEATION: ['Abstract & Problem Statement', 'Proposed Solution & Innovation', 'Working & System Design', 'Reliability & Testing', 'Real-Life Applications & Future Scope'],
  ROBOTICS_TOP_N: 20,

  // A team is disqualified if its leader rated fewer projects than this
  MIN_VOTES: { game: 5, web: 10, robotics: 5 },

  // Vote rules
  LEADER_SAME_CATEGORY_ONLY: true, // a game leader rates game projects, web leader rates web projects...
  MAX_SUBMISSIONS: 3,              // 1 vote counts per project; it can be edited (MAX_SUBMISSIONS - 1) times

};
