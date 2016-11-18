import Exponent from 'exponent';
import React from 'react';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

const RCTDeviceEventEmitter = require('RCTDeviceEventEmitter');

import Player from './Entities/Player';
import Surface from './Entities/Surface';
import HUD from './HUD/HUD';
import { SmallParticle, RadialParticle, BadParticle } from './Entities/Particles';

const THREE = require('three');
const THREEView = Exponent.createTHREEViewClass(THREE);

const GAME_FINISHED = 0;
const GAME_STARTED = 1;
const LEVEL_COLORS = [
  '#ee0000',
  '#eeaa00',
  '#efef00',
  '#00ee00',
  '#00eeee',
  '#ee00ee',
  '#ff7777',
  '#007700',
  '#0077ee',
  '#666666'
];

export default class Game extends React.Component {
  state = {
    gameStatus: GAME_STARTED,
    level: 0,
    hudTop: 0,
    overlayWidth: 0,
  };

  componentDidMount() {
    RCTDeviceEventEmitter.addListener('didUpdateDimensions', this.restart.bind(this));
    this.restart();
  }

  render() {
    const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: this._touch.bind(this),
      onPanResponderMove: this._touch.bind(this),
      onPanResponderRelease: this._release.bind(this),
      onPanResponderTerminate: this._release.bind(this),
      onShouldBlockNativeResponder: () => false,
    });
    let otherStuff = (this.state.gameStatus == GAME_FINISHED) ? this._renderGameOver() : this._renderReactHUD();
    return (
      <View {...this.props}>
        <THREEView
          style={this.props.style}
          {...panResponder.panHandlers}
          scene={this._scene}
          camera={this._camera}
          tick={this._tick.bind(this)}
        />
        {otherStuff}
      </View>
    );
  }

  _renderGameOver() {
    return (
      <View style={[styles.gameOver, { width: this.state.overlayWidth }]}>
        <Text style={styles.gameOverText}>GAME OVER</Text>
        <Text style={styles.detailText}>MAX PWR {this._maxLevel}</Text>
        <TouchableWithoutFeedback
          style={styles.restartButton}
          onPress={this.restart.bind(this)}>
          <View><Text style={styles.restartText}>RESTART</Text></View>
        </TouchableWithoutFeedback>
      </View>
    );
  }

  _renderReactHUD() {
    return (
      <View style={[styles.hud, { top: this.state.hudTop }]}>
        <Text style={[styles.levelText, { color: this.getLevelColor() }]}>
          PWR {this.state.level}
        </Text>
      </View>
    );
  }

  getGame() {
    return this;
  }

  getDifficulty() {
    return this._difficulty;
  }

  getLevelColor() {
    let colorIdx = (this.state.level < LEVEL_COLORS.length) ? this.state.level : LEVEL_COLORS.length - 1;
    return LEVEL_COLORS[colorIdx];
  }

  onPlatformLanded(platform) {
    let newNumPlatformsLanded = this._numPlatformsLanded + 1;
    if (newNumPlatformsLanded == 5) {
      this.setIsInverted(!this._isInverted, true);
      this._setNumPlatformsLanded(0);
      this._setLevel(this.state.level + 1);
      for (let ii = 0; ii < 5; ii++) {
        let particle = new RadialParticle(this._scene, this._viewport, {
          position: {
            x: this._player.getPositionX(),
            y: 0,
          },
          scaleFactor: (ii + 1) * 3,
        });
        this._particles[this._nextParticleId++] = particle;
      }
    } else {
      this._setNumPlatformsLanded(newNumPlatformsLanded);
    }
    let particles = platform.getImpactParticles(this._isInverted);
    for (let ii = 0; ii < particles.length; ii++) {
      this._particles[this._nextParticleId++] = particles[ii];
    }
  }

  onPlatformMissed() {
    this._setNumPlatformsLanded(0);
    this.setIsInverted(!this._isInverted, false);
    if (this.state.level > 0) {
      this._setLevel(this.state.level - 1);
      this._makeBadParticles();
    } else {
      // begin game over sequence
      this._player.explode();
    }
  }

  _makeBadParticles() {
    for (let ii = 0; ii < 5; ii++) {
      let particle = new BadParticle(this._scene, this._viewport, {
        position: {
          x: this._player.getPositionX(),
          y: 0,
        },
        scaleMult: 0.99 - (ii * 0.01),
        aVel: ii * 2.0,
      });
      this._particles[this._nextParticleId++] = particle;
    }
  }

  _setNumPlatformsLanded(numPlatformsLanded) {
    this._numPlatformsLanded = numPlatformsLanded;
    this._hud.setProgress(this._numPlatformsLanded / 4.0);
  }

  _setLevel(level) {
    if (level !== this.state.level) {
      if (level > this.state.level) {
        // difficulty will only increase, not go back down
        this._difficulty += (level - this.state.level);
        this._player.setMaxVelMore(this._difficulty);
        this._maxLevel = level;
      }
      this.setState({ level }, () => {
        this._hud.setLevel(level);
      });
    } else {
      this._hud.setLevel(level);
    }
  }

  setIsInverted(isInverted, isLevelUp) {
    this._isInverted = isInverted;
    if (this.state.gameStatus == GAME_STARTED) {
      this._player.setIsInverted(isInverted, isLevelUp);
    }
  }

  gameOver() {
    if (this.state.gameStatus === GAME_STARTED) {
      this.setState({ gameStatus: GAME_FINISHED }, () => {
        this._player.destroy(this._scene);
        this._player = null;
        this._hud.destroy(this._scene);
        this._hud = null;
      });
    }
  }

  _tick(dt) {
    this._updateCamera();
    if (this.state.gameStatus === GAME_STARTED) {
      this._player.tick(dt);
      if (this._hud) {
        this._hud.tick(dt);
      }
    }
    this._surface.tick(dt);
    for (let key in this._particles) {
      if (this._particles.hasOwnProperty(key)) {
        this._particles[key].tick(dt);
        if (!this._particles[key].isAlive()) {
          this._particles[key].destroy(this._scene);
          delete this._particles[key];
        }
      }
    }
  }

  _touch(event, gesture) {
    let { nativeEvent } = event;
    let touches = nativeEvent ? nativeEvent.touches : null;
    if (this.state.gameStatus == GAME_STARTED) {
      this._player.touch(touches, gesture);
    }
  };

  _release(event, gesture) {
    let { nativeEvent } = event;
    let touches = nativeEvent ? nativeEvent.changedTouches : null;
    if (this.state.gameStatus == GAME_STARTED) {
      this._player.release(touches, gesture);
    }
  }

  restart() {
    if (this._player) {
      this._player.destroy(this._scene);
      this._player = null;
    }
    if (this._surface) {
      this._surface.destroy(this._scene);
      this._surface = null;
    }
    if (this._hud) {
      this._hud.destroy(this._scene);
      this._hud = null;
    }
    if (this._particles) {
      for (let key in this._particles) {
        if (this._particles.hasOwnProperty(key)) {
          this._particles[key].destroy(this._scene);
        }
      }
      this._particles = null;
    }
    this._restartCamera();

    this._scene = new THREE.Scene();
    this._isInverted = false;
    this._numPlatformsLanded = 0;
    this._difficulty = 0;
    this._surface = new Surface(this.getGame.bind(this), this._scene, this._viewport);
    this._player = new Player(this._scene, this._viewport, this._surface);
    this._hud = new HUD(this.getGame.bind(this), this._scene, this._viewport);
    this._particles = {};
    this._nextParticleId = 0;
    this._maxLevel = 0;
    this._setLevel(0);
    this.setState({
      gameStatus: GAME_STARTED,
      hudTop: this._viewport.screenHeight - 56,
      overlayWidth: this._viewport.screenWidth,
    });
  }

  _restartCamera() {
    let width, height;
    let { width: screenWidth, height: screenHeight } = Dimensions.get('window');
    console.log('setting up camera with screen width/height:', screenWidth, screenHeight)
    if (screenWidth > screenHeight) {
      width = 4;
      height = (screenHeight / screenWidth) * width;
      this._camera = new THREE.OrthographicCamera(
        -width / 2, width / 2,
        height / 2, -height / 2,
        1, 10000,
      );
    } else {
      width = 4;
      height = (screenWidth / screenHeight) * width;
      this._camera = new THREE.OrthographicCamera(
        -width / 2, width / 2,
        height / 2, -height / 2,
        1, 10000,
      );
    }
    this._camera.position.z = 1000;
    this._viewport = {
      width,
      height,
      screenWidth: (screenWidth > screenHeight) ? screenWidth : screenHeight,
      screenHeight: (screenWidth > screenHeight) ? screenHeight : screenWidth,
    };
  }

  _updateCamera() {
    if (this.state.gameStatus === GAME_STARTED) {
      let playerPos = this._player.getPositionX();
      this._camera.left = playerPos - this._viewport.width * 0.5;
      this._camera.right = playerPos + this._viewport.width * 0.5;
      this._camera.updateProjectionMatrix();
      this._surface.cameraDidUpdate(playerPos);
      this._hud.cameraDidUpdate(playerPos);
    }
  }
};

let styles = StyleSheet.create({
  gameOver: {
    position: 'absolute',
    top: 96,
    left: 0,
    height: 128,
    backgroundColor: 'transparent',
  },
  gameOverText: {
    color: '#ff00ff',
    fontFamily: 'monofont',
    backgroundColor: 'transparent',
    fontSize: 64,
    textAlign: 'center',
  },
  restartButton: {
    backgroundColor: 'transparent',
  },
  restartText: {
    textAlign: 'center',
    color: '#ff0000',
    fontFamily: 'monofont',
    fontSize: 24,
    margin: 12,
  },
  detailText: {
    textAlign: 'center',
    color: '#000000',
    fontFamily: 'monofont',
    fontSize: 24,
    margin: 8,
  },
  hud: {
    position: 'absolute',
    left: 12,
    width: 128,
    backgroundColor: 'transparent',
  },
  levelText: {
    backgroundColor: 'transparent',
    fontSize: 24,
    fontFamily: 'monofont',
  },
})
