'use client'
import {useState} from 'react'
import type {SearchValues} from './SearchCard'

export type Trip={
  id:string
  fromStationId:number
  toStationId:number
  from:string
  to:string
  start:string
  end:string
  duration:string
  price:number
}

const MOCK:Trip[]=[
  {
    id:'1',
    fromStationId:1,
    toStationId:2,
    from:'Botoșani',
    to:'Iași',
    start:'08:00',
    end:'10:30',
    duration:'2h 30m',
    price:45,
  },
  {
    id:'2',
    fromStationId:1,
    toStationId:2,
    from:'Botoșani',
    to:'Iași',
    start:'12:00',
    end:'14:30',
    duration:'2h 30m',
    price:45,
  },
  {
    id:'3',
    fromStationId:1,
    toStationId:2,
    from:'Botoșani',
    to:'Iași',
    start:'17:00',
    end:'19:30',
    duration:'2h 30m',
    price:45,
  },
]
export default function Trips(){
  const [results,setResults]=useState<Trip[]>(MOCK)
    const handleSearch=(s:SearchValues)=>{
    setResults(
      MOCK.filter(
        t=>t.fromStationId===s.fromStationId&&t.toStationId===s.toStationId,
      ),
    )
  }
  return(<section className="max-w-6xl mx-auto px-4" id="curse">
    <div className="hero-gradient rounded-[40px] pt-16 pb-14 md:pt-24 md:pb-16 px-4 md:px-10 mt-6 shadow-soft">
      <nav className="flex items-center justify-between mb-12">
        <div className="text-4xl md:text-5xl font-extrabold tracking-tight">Călătorește cu Confort</div>
        <div className="hidden md:block text-white/70 max-w-md">Descoperă destinații noi cu cel mai bun serviciu de transport</div>
      </nav>
      <div className="max-w-4xl mx-auto">{/* Search here if needed */}</div>
    </div>
  </section>)
}
