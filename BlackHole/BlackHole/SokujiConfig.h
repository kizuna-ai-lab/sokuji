//==============================================================================
//  SokujiConfig.h - Custom configuration for Sokuji Virtual Audio
//==============================================================================

#ifndef SokujiConfig_h
#define SokujiConfig_h

// Override BlackHole defaults - According to BlackHole documentation,
// these three are mandatory for customization
#undef kDriver_Name
#undef kPlugIn_BundleID
#undef kPlugIn_Icon

// Optional overrides
#undef kDevice_Name
#undef kNumber_Of_Channels

// Mandatory Configuration (required by BlackHole documentation)
#define kDriver_Name                             "Sokuji"
#define kPlugIn_BundleID                         "com.sokuji.virtualaudio"
#define kPlugIn_Icon                             "BlackHole.icns"  // Using existing icon

// Device Configuration
#define kDevice_Name                             "Sokuji Virtual Audio"

// Channel Configuration (2-channel only)
#define kNumber_Of_Channels                      2

#endif /* SokujiConfig_h */
