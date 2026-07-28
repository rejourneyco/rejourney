/**
 * React Native CLI Configuration for Rejourney SDK
 * 
 * This file tells React Native autolinking where to find
 * the native Android and iOS code.
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.rejourney.RejourneyPackage;',
        packageInstance: 'new RejourneyPackage()',
      },
      // Current React Native CLI versions discover the root podspec
      // automatically. Only user-overridable iOS options belong here.
      ios: {},
    },
  },
};
