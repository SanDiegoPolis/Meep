<view class="page">
  <view class="eyebrow">MIANJI ATLAS · QQ 小程序原型</view>
  <view class="title">世界地图</view>
  <view class="hint">点地图标记或成员名字查看城市和资料。</view>
  <view class="map">
    <image class="world" src="/assets/world.svg" mode="scaleToFill" aria-label="静态世界地图"></image>
    <view class="pin" qq:for="{{groups}}" qq:key="id" style="{{item.position}}" data-id="{{item.id}}" bindtap="openGroup">
      <text class="initial">{{item.first.initial}}</text>
      <text>{{item.first.displayName}}</text>
      <text class="pin-count" qq:if="{{item.members.length > 1}}">+{{item.members.length - 1}}</text>
    </view>
  </view>

  <view class="panel" qq:if="{{selected || nearby.length}}">
    <view class="panel-heading">
      <text class="heading">{{selected ? selected.displayName : '附近的成员'}}</text>
      <text class="link" bindtap="closeDetails">关闭</text>
    </view>
    <view qq:if="{{selected}}">
      <view class="hint">{{selected.city.name}} · {{selected.city.country}}</view>
      <view class="status {{selected.status}}"><text class="dot"></text>{{selected.statusLabel}}</view>
      <view class="fact" qq:for="{{selected.facts}}" qq:key="label">
        <text class="fact-label">{{item.label}}</text><text>{{item.value}}</text>
      </view>
    </view>
    <view class="row" qq:for="{{nearby}}" qq:key="id" data-id="{{item.id}}" bindtap="showMember">
      <text class="initial">{{item.initial}}</text><text>{{item.displayName}}</text><text class="city">{{item.city.name}}</text>
    </view>
  </view>

  <view class="panel">
    <view class="panel-heading"><text class="heading">演示成员</text><text class="hint">{{members.length}} 人</text></view>
    <view class="row" qq:for="{{members}}" qq:key="id" data-id="{{item.id}}" bindtap="showMember">
      <text class="initial">{{item.initial}}</text><text>{{item.displayName}}</text><text class="city">{{item.city.name}}</text>
    </view>
  </view>

  <view class="panel">
    <button class="login" bindtap="testLogin" loading="{{testingLogin}}" disabled="{{testingLogin}}">测试 QQ 登录接口</button>
    <view class="hint" qq:if="{{loginMessage}}">{{loginMessage}}</view>
    <view class="hint">底图 Natural Earth · 城市 GeoNames · 虚构资料</view>
  </view>
</view>
