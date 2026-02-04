import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, FlatList, 
  TextInput, Image, Alert, SafeAreaView, ActivityIndicator, 
  Dimensions, Animated, PanResponder, Modal 
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

const { width, height } = Dimensions.get('window');

type ViewMode = 'HOME' | 'SYNC' | 'PLAYER' | 'SONG_LIST';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('HOME');
  const [serverIp, setServerIp] = useState<string>('');
  const [pcPlaylists, setPcPlaylists] = useState<any[]>([]); 
  const [selectedPls, setSelectedPls] = useState<Set<number>>(new Set()); 
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [localLibrary, setLocalLibrary] = useState<any[]>([]); 
  const [localPlaylists, setLocalPlaylists] = useState<any[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState<any>(null);
  
  // 再生系
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSong, setCurrentSong] = useState<any>(null);
  const [playbackStatus, setPlaybackStatus] = useState<any>(null);
  const [playQueue, setPlayQueue] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // フルプレイヤーのアニメーション
  const [isFullPlayer, setIsFullPlayer] = useState(false);
  const slideAnim = useRef(new Animated.Value(height)).current;

  const DEFAULT_ICON = 'https://reactnative.dev/img/tiny_logo.png'; 

  useEffect(() => { loadLocalData(); }, []);

  const loadLocalData = async () => {
    try {
      const libData = await AsyncStorage.getItem('local_library');
      const plData = await AsyncStorage.getItem('local_playlists');
      if (libData) setLocalLibrary(JSON.parse(libData));
      if (plData) setLocalPlaylists(JSON.parse(plData));
    } catch (e) { console.error(e); }
  };

  // --- 同期処理 ---
  const fetchPCPlaylists = async () => {
    const host = serverIp.includes(':') ? serverIp : `${serverIp}:5000`;
    try {
      setSyncProgress('接続中...');
      const res = await fetch(`http://${host}/api/playlists`);
      const data = await res.json();
      setPcPlaylists(data.playlists || []);
      setSyncProgress('プレイリストを取得しました');
    } catch (e) { Alert.alert("接続失敗", "PCが見つかりません。"); setSyncProgress(''); }
  };

  const startSyncDownload = async (isAll: boolean) => {
    const host = serverIp.includes(':') ? serverIp : `${serverIp}:5000`;
    setIsSyncing(true);
    try {
      const resLib = await fetch(`http://${host}/api/library`);
      const dataLib = await resLib.json();
      const allSongs = dataLib.library || [];
      let targetPlaylists = isAll ? pcPlaylists : pcPlaylists.filter((_, i) => selectedPls.has(i));
      let targetMusicNames = new Set(targetPlaylists.map(pl => pl.music).flat());
      let targets = isAll ? allSongs : allSongs.filter((s: any) => targetMusicNames.has(s.musicFilename.split(/[\\/]/).pop()));
      let downloadedData: any[] = [];
      const fs = FileSystem as any;
      const baseDir = fs.documentDirectory;

      for (let i = 0; i < targets.length; i++) {
        const song = targets[i];
        const musicFname = song.musicFilename.split(/[\\/]/).pop();
        const imgFname = song.imageFilename ? song.imageFilename.split(/[\\/]/).pop() : null;
        setSyncProgress(`同期中 (${i + 1}/${targets.length})\n${song.title}`);
        const musicLocalUri = baseDir + musicFname;
        await FileSystem.downloadAsync(`http://${host}${song.url_music}`, musicLocalUri);
        let imgLocalUri = "";
        if (imgFname) {
          imgLocalUri = baseDir + imgFname;
          await FileSystem.downloadAsync(`http://${host}${song.url_image}`, imgLocalUri);
        }
        downloadedData.push({ ...song, localMusicUri: musicLocalUri, localImageUri: imgLocalUri });
      }
      await AsyncStorage.setItem('local_library', JSON.stringify(downloadedData));
      await AsyncStorage.setItem('local_playlists', JSON.stringify(targetPlaylists));
      setLocalLibrary(downloadedData); setLocalPlaylists(targetPlaylists);
      setIsSyncing(false); Alert.alert("完了", "同期しました！"); setViewMode('HOME');
    } catch (e) { setIsSyncing(false); Alert.alert("エラー", "失敗しました。"); }
  };

  // --- 再生処理 ---
  const loadAndPlay = async (song: any) => {
    try {
      if (sound) await sound.unloadAsync();
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true });
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: song.localMusicUri }, { shouldPlay: true }, onPlaybackStatusUpdate
      );
      setSound(newSound); setCurrentSong(song); setIsPlaying(true);
    } catch (e) { Alert.alert("エラー", "再生に失敗しました。"); }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPlaybackStatus(status);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) handleNext();
    }
  };

  const togglePlayPause = async () => {
    if (!sound) return;
    if (isPlaying) await sound.pauseAsync(); else await sound.playAsync();
  };

  const handleNext = () => {
    if (currentIndex < playQueue.length - 1) {
      const n = currentIndex + 1; setCurrentIndex(n); loadAndPlay(playQueue[n]);
    } else {
        stopPlayback();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const p = currentIndex - 1; setCurrentIndex(p); loadAndPlay(playQueue[p]);
    }
  };

  const stopPlayback = async () => {
      if (sound) await sound.stopAsync();
      setIsPlaying(false);
  };

  const startQueue = (songs: any[], index: number, shuffle = false) => {
    let queue = [...songs];
    let startIdx = index;
    if (shuffle) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      startIdx = 0;
    }
    setPlayQueue(queue); setCurrentIndex(startIdx); loadAndPlay(queue[startIdx]);
  };

  // --- プレイヤーアニメーション ---
  const openFullPlayer = () => {
    setIsFullPlayer(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 30, friction: 9 }).start();
  };

  const closeFullPlayer = () => {
    Animated.timing(slideAnim, { toValue: height, duration: 300, useNativeDriver: true }).start(() => setIsFullPlayer(false));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 10,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) slideAnim.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 || gesture.vy > 0.5) closeFullPlayer();
        else openFullPlayer();
      }
    })
  ).current;

  // --- ユーティリティ ---
  const getPlaylistSongs = (playlist: any) => {
    if (!playlist) return [];
    if (playlist.isAll) return localLibrary;
    return localLibrary.filter(s => playlist.music.includes(s.musicFilename.split(/[\\/]/).pop()));
  };

  const formatTotalTime = (songs: any[]) => {
    let t = 0;
    songs.forEach(s => {
        const p = s.duration?.split(':');
        if (p?.length === 2) t += parseInt(p[0]) * 60 + parseInt(p[1]);
    });
    return t < 3600 ? `${Math.floor(t / 60)}分` : `${(t / 3600).toFixed(1)}時間`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      
      {viewMode === 'HOME' && (
        <View style={styles.centerContainer}>
          <View style={styles.logoCircle}><Text style={styles.logoText}>MM</Text></View>
          <Text style={styles.appName}>Music Manager</Text>
          <TouchableOpacity style={styles.mainBtn} onPress={() => setViewMode('SYNC')}><Text style={styles.btnText}>PC版と同期</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.mainBtn, {backgroundColor:'#10b981'}]} onPress={() => setViewMode('PLAYER')}><Text style={styles.btnText}>楽曲を再生</Text></TouchableOpacity>
        </View>
      )}

      {viewMode === 'SYNC' && (
        <View style={{flex:1}}>
          <View style={styles.headerBar}>
            <TouchableOpacity onPress={() => setViewMode('HOME')}><Text style={styles.linkText}>← 戻る</Text></TouchableOpacity>
            <Text style={styles.headerTitle}>同期設定</Text>
            <View style={{width:50}} />
          </View>
          <View style={styles.syncCard}>
            <TextInput style={styles.input} placeholder="PCのIPアドレス" value={serverIp} onChangeText={setServerIp} keyboardType="decimal-pad" />
            <TouchableOpacity style={styles.smallBtn} onPress={fetchPCPlaylists}><Text style={styles.btnText}>プレイリストを取得</Text></TouchableOpacity>
            {syncProgress ? <Text style={styles.statusText}>{syncProgress}</Text> : null}
            {isSyncing && <ActivityIndicator color="#4f46e5" style={{marginTop:10}} />}
          </View>
          <FlatList data={pcPlaylists} keyExtractor={(_, i) => i.toString()} renderItem={({item, index}) => (
            <TouchableOpacity style={styles.checkRow} onPress={() => {
              const next = new Set(selectedPls); if (next.has(index)) next.delete(index); else next.add(index); setSelectedPls(next);
            }}>
              <Text style={{fontSize:22}}>{selectedPls.has(index) ? '☑️' : '⬜'}</Text>
              <Text style={styles.rowTitle}>{item.playlistName}</Text>
            </TouchableOpacity>
          )} />
          {pcPlaylists.length > 0 && (
            <View style={styles.bottomBar}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => startSyncDownload(false)}><Text style={styles.actionBtnText}>選択したプレイリストを同期</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#6b7280'}]} onPress={() => startSyncDownload(true)}><Text style={styles.actionBtnText}>全楽曲を同期</Text></TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {viewMode === 'PLAYER' && (
        <View style={{flex:1}}>
          <View style={styles.headerBar}>
            <TouchableOpacity onPress={() => setViewMode('HOME')}><Text style={styles.linkText}>← 戻る</Text></TouchableOpacity>
            <Text style={styles.headerTitle}>再生</Text>
            <View style={{width:50}} />
          </View>
          <FlatList data={[{playlistName: 'すべての楽曲', isAll: true}, ...localPlaylists]} keyExtractor={(_, i) => i.toString()} renderItem={({item}) => (
            <TouchableOpacity style={styles.checkRow} onPress={() => { setCurrentPlaylist(item); setViewMode('SONG_LIST'); }}>
              <View style={styles.iconBox}><Ionicons name="musical-notes" size={20} color="#4f46e5" /></View>
              <Text style={styles.rowTitle}>{item.playlistName}</Text>
            </TouchableOpacity>
          )} />
        </View>
      )}

      {viewMode === 'SONG_LIST' && currentPlaylist && (
        <View style={{flex:1, paddingBottom: 80}}>
          <View style={styles.headerBar}>
            <TouchableOpacity onPress={() => setViewMode('PLAYER')}><Text style={styles.linkText}>← 戻る</Text></TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{currentPlaylist.playlistName}</Text>
            <View style={{width:50}} />
          </View>
          <FlatList
            data={getPlaylistSongs(currentPlaylist)}
            ListHeaderComponent={() => {
              const sng = getPlaylistSongs(currentPlaylist);
              return (
                <View style={styles.plDetailHeader}>
                  <Image source={sng[0]?.localImageUri ? {uri: sng[0].localImageUri} : {uri: DEFAULT_ICON}} style={styles.largeArt} />
                  <View style={styles.plDetailInfo}>
                    <Text style={styles.plDetailTitle}>{currentPlaylist.playlistName}</Text>
                    <Text style={styles.plDetailSub}>{sng.length}曲 ・ {formatTotalTime(sng)}</Text>
                    <View style={styles.plActionRow}>
                      <TouchableOpacity style={styles.plBtn} onPress={() => startQueue(sng, 0, false)}><Ionicons name="play" size={18} color="#fff" /><Text style={styles.plBtnText}>再生</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.plBtn, {backgroundColor:'#f3f4f6'}]} onPress={() => startQueue(sng, 0, true)}><Ionicons name="shuffle" size={18} color="#333" /><Text style={[styles.plBtnText, {color:'#333'}]}>シャッフル</Text></TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }}
            keyExtractor={(_, i) => i.toString()}
            renderItem={({item, index}) => (
              <TouchableOpacity style={styles.songRow} onPress={() => startQueue(getPlaylistSongs(currentPlaylist), index, false)}>
                <Image source={item.localImageUri ? {uri: item.localImageUri} : {uri: DEFAULT_ICON}} style={styles.smallArt} />
                <View style={{flex:1}}><Text style={styles.songTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.songSub} numberOfLines={1}>{item.artist}</Text></View>
                <Text style={styles.songTime}>{item.duration}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ミニプレイヤー */}
      {currentSong && !isFullPlayer && (
        <TouchableOpacity style={styles.miniPlayerContainer} onPress={openFullPlayer} activeOpacity={0.9}>
            <BlurView intensity={80} tint="light" style={styles.miniPlayerBlur}>
                <Image source={currentSong.localImageUri ? {uri: currentSong.localImageUri} : {uri: DEFAULT_ICON}} style={styles.miniArt} />
                <View style={styles.miniInfo}>
                    <Text style={styles.miniTitle} numberOfLines={1}>{currentSong.title}</Text>
                    <Text style={styles.miniArtist} numberOfLines={1}>{currentSong.artist}</Text>
                </View>
                <TouchableOpacity onPress={togglePlayPause} style={styles.miniPlayBtn}>
                    <Ionicons name={isPlaying ? "pause" : "play"} size={28} color="#000" />
                </TouchableOpacity>
            </BlurView>
        </TouchableOpacity>
      )}

      {/* フルプレイヤー */}
      <Modal visible={isFullPlayer} transparent animationType="none">
        <View style={styles.fullPlayerOverlay}>
            <Animated.View 
              style={[styles.fullPlayerContainer, { transform: [{ translateY: slideAnim }] }]} 
              {...panResponder.panHandlers}
            >
                {/* ★背景にアルバムアートをぼかして配置 (Apple Music スタイル) */}
                <Image 
                    source={currentSong?.localImageUri ? {uri: currentSong.localImageUri} : {uri: DEFAULT_ICON}} 
                    style={StyleSheet.absoluteFill}
                    blurRadius={60} 
                />
                
                {/* ガラス質感のオーバーレイ */}
                <BlurView intensity={40} tint="dark" style={styles.fullPlayerContent}>
                    {/* 閉じるハンドル */}
                    <TouchableOpacity style={styles.dismissArea} onPress={closeFullPlayer}>
                        <View style={styles.fullPlayerHandle} />
                    </TouchableOpacity>

                    <View style={styles.fullCenterContent}>
                        <Image 
                            source={currentSong?.localImageUri ? {uri: currentSong.localImageUri} : {uri: DEFAULT_ICON}} 
                            style={styles.fullArt} 
                        />
                        
                        <View style={styles.fullMeta}>
                            <Text style={styles.fullTitle} numberOfLines={1}>{currentSong?.title}</Text>
                            <Text style={styles.fullArtist} numberOfLines={1}>{currentSong?.artist}</Text>
                        </View>

                        <View style={styles.fullSeekBarArea}>
                            <Slider
                                style={{width: '100%', height: 40}}
                                minimumValue={0} maximumValue={playbackStatus?.durationMillis || 100}
                                value={playbackStatus?.positionMillis || 0}
                                minimumTrackTintColor="#fff" maximumTrackTintColor="rgba(255,255,255,0.3)"
                                thumbTintColor="#fff"
                                onSlidingComplete={async (v) => { if (sound) await sound.setPositionAsync(v); }}
                            />
                            <View style={styles.fullTimeRow}>
                                <Text style={styles.timeTextSmall}>{formatMillis(playbackStatus?.positionMillis)}</Text>
                                <Text style={styles.timeTextSmall}>-{formatMillis((playbackStatus?.durationMillis || 0) - (playbackStatus?.positionMillis || 0))}</Text>
                            </View>
                        </View>

                        <View style={styles.fullControls}>
                            <TouchableOpacity onPress={handlePrev}><Ionicons name="play-back-sharp" size={44} color="#fff" /></TouchableOpacity>
                            <TouchableOpacity onPress={togglePlayPause} style={styles.fullPlayBtn}>
                                <Ionicons name={isPlaying ? "pause-sharp" : "play-sharp"} size={70} color="#fff" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleNext}><Ionicons name="play-forward-sharp" size={44} color="#fff" /></TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const formatMillis = (ms: number | undefined) => {
    if (!ms) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  logoText: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  appName: { fontSize: 24, fontWeight: 'bold', marginBottom: 40, color: '#1f2937' },
  mainBtn: { width: '75%', padding: 18, borderRadius: 15, backgroundColor: '#4f46e5', marginBottom: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  headerBar: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingTop: 50 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#111827', flex: 1, textAlign: 'center' },
  linkText: { color: '#4f46e5', fontSize: 15, fontWeight: '600', minWidth: 50 },
  syncCard: { padding: 20, backgroundColor: '#f9fafb', margin: 15, borderRadius: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', padding: 12, borderRadius: 10, marginBottom: 10 },
  smallBtn: { backgroundColor: '#4f46e5', padding: 12, borderRadius: 10, alignItems: 'center' },
  statusText: { marginTop: 12, textAlign: 'center', color: '#6b7280' },
  checkRow: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', alignItems: 'center' },
  rowTitle: { marginLeft: 12, fontSize: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  bottomBar: { padding: 20, paddingBottom: 40 },
  actionBtn: { backgroundColor: '#4f46e5', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  plDetailHeader: { padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  largeArt: { width: 180, height: 180, borderRadius: 12, backgroundColor: '#eee', shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  plDetailInfo: { alignItems: 'center', marginTop: 15 },
  plDetailTitle: { fontSize: 24, fontWeight: 'bold' },
  plDetailSub: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  plActionRow: { flexDirection: 'row', gap: 15, marginTop: 15 },
  plBtn: { backgroundColor: '#4f46e5', paddingVertical: 10, paddingHorizontal: 25, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  plBtnText: { color: '#fff', fontWeight: 'bold' },
  songRow: { flexDirection: 'row', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb', alignItems: 'center' },
  smallArt: { width: 45, height: 45, borderRadius: 6, marginRight: 12 },
  songTitle: { fontSize: 16, fontWeight: '500' },
  songSub: { fontSize: 13, color: '#8e8e93' },
  songTime: { fontSize: 12, color: '#999', marginLeft: 10 },
  miniPlayerContainer: { position: 'absolute', bottom: 40, left: 15, right: 15, height: 64, borderRadius: 32, overflow: 'hidden', shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 10 },
  miniPlayerBlur: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  miniArt: { width: 48, height: 48, borderRadius: 24 },
  miniInfo: { flex: 1, marginLeft: 12 },
  miniTitle: { fontSize: 15, fontWeight: 'bold' },
  miniArtist: { fontSize: 12, color: '#666' },
  miniPlayBtn: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  fullPlayerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  fullPlayerContainer: { position: 'absolute', top: 40, left: 0, right: 0, bottom: 0, borderTopLeftRadius: 40, borderTopRightRadius: 40, overflow: 'hidden', backgroundColor: '#000' },
  fullPlayerContent: { flex: 1, padding: 30, alignItems: 'center' },
  dismissArea: { width: '100%', alignItems: 'center', paddingVertical: 15 },
  fullPlayerHandle: { width: 40, height: 5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 3 },
  fullCenterContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'space-around' },
  fullArt: { width: width * 0.85, height: width * 0.85, borderRadius: 20, backgroundColor: '#eee', shadowColor: "#000", shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.5, shadowRadius: 40 },
  fullMeta: { alignItems: 'center', width: '100%' },
  fullTitle: { fontSize: 26, fontWeight: 'bold', textAlign: 'center', color: '#fff' },
  fullArtist: { fontSize: 20, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
  fullSeekBarArea: { width: '100%' },
  fullTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -5 },
  timeTextSmall: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' },
  fullControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '80%', marginBottom: 40 },
  fullPlayBtn: { width: 100, height: 100, justifyContent: 'center', alignItems: 'center' }
});